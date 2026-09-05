import { connect, type TLSSocket } from 'node:tls';

/**
 * A dependency-free SMTP sender for exactly one job: the nightly backup
 * mail. Implicit TLS (port 465), AUTH LOGIN, one attachment — Gmail's app
 * passwords speak this dialect happily, and no mail library joins the
 * project for one message a day.
 */

export interface MailJob {
  host: string;
  port: number;
  user: string;
  pass: string;
  to: string;
  subject: string;
  text: string;
  attachment: { filename: string; content: Buffer };
}

/** RFC 2047 so an Arabic subject survives every relay. */
export function encodeSubject(subject: string): string {
  return `=?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`;
}

/**
 * The whole message, built as a pure string — testable without a socket.
 * Base64 lines are wrapped at 76 columns per MIME.
 */
export function buildMime(job: MailJob): string {
  const boundary = `----aqaba-${Date.now().toString(16)}`;
  const attachment64 = job.attachment.content
    .toString('base64')
    .replace(/(.{76})/g, '$1\r\n');
  return [
    `From: <${job.user}>`,
    `To: <${job.to}>`,
    `Subject: ${encodeSubject(job.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(job.text, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n'),
    `--${boundary}`,
    `Content-Type: application/octet-stream; name="${job.attachment.filename}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${job.attachment.filename}"`,
    '',
    attachment64,
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

/** One SMTP exchange over implicit TLS. Resolves on 250 after DATA. */
export function sendMail(job: MailJob): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket: TLSSocket = connect({ host: job.host, port: job.port, servername: job.host });
    let buffer = '';
    let settled = false;
    const fail = (why: string): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(new Error(why));
    };
    socket.setTimeout(60_000, () => {
      fail('smtp timeout');
    });
    socket.on('error', (error) => {
      fail(`smtp socket: ${error.message}`);
    });

    // The dialogue, one expected reply code per step.
    const steps: Array<{ expect: string; send: () => void }> = [
      { expect: '220', send: () => write(`EHLO aqaba-yard\r\n`) },
      { expect: '250', send: () => write(`AUTH LOGIN\r\n`) },
      { expect: '334', send: () => write(`${Buffer.from(job.user).toString('base64')}\r\n`) },
      { expect: '334', send: () => write(`${Buffer.from(job.pass).toString('base64')}\r\n`) },
      { expect: '235', send: () => write(`MAIL FROM:<${job.user}>\r\n`) },
      { expect: '250', send: () => write(`RCPT TO:<${job.to}>\r\n`) },
      { expect: '250', send: () => write(`DATA\r\n`) },
      { expect: '354', send: () => write(`${buildMime(job)}\r\n.\r\n`) },
      {
        expect: '250',
        send: () => {
          write('QUIT\r\n');
          settled = true;
          socket.end();
          resolve();
        },
      },
    ];
    let at = 0;
    const write = (text: string): void => {
      socket.write(text);
    };
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      // A reply may arrive in pieces; act only on a complete final line
      // («250 …» — a dash after the code marks a continuation line).
      const lines = buffer.split('\r\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (/^\d{3}-/.test(line)) continue;
        const step = steps[at];
        if (step === undefined) return;
        if (!line.startsWith(step.expect)) {
          fail(`smtp step ${String(at)}: expected ${step.expect}, got «${line}»`);
          return;
        }
        at += 1;
        step.send();
      }
    });
  });
}
