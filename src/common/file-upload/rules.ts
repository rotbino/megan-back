/**
 * ─── قواعد مشترک پیوست گفتگوها (چت + پشتیبانی) ──────────────────────────────
 * استخراج‌شده از ChatService (خواستهٔ مالک ۸-۱۱: پیوست در پشتیبانی هم
 * خواسته شد) — همان لیست سفید، همان سقف ۵MB، همان بایت‌های جادویی.
 * منبع واحد یعنی قواعد دو ماژول هرگز از هم واگرا نمی‌شوند.
 */

import { AppError } from '../errors/app-error';

/** سقف حجم پیوست گفتگو — ۵ مگابایت */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

/** پسوندهای مجاز به تفکیک نوع — لیست سفید؛ هر چیز دیگر (exe، sh، js،
 *  php، svg، zip و…) رد می‌شود تا فایل قابل‌سوءاستفاده وارد گفتگو نشود. */
export const FILE_RULES = {
  image: {
    exts: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
    mimes: ['image/jpeg', 'image/pjpeg', 'image/png', 'image/gif', 'image/webp'],
  },
  video: {
    exts: ['mp4', 'webm', 'mov'],
    mimes: ['video/mp4', 'video/webm', 'video/quicktime'],
  },
  file: {
    // اسناد رایج اداری — svg و html و js و بقیهٔ کد/اجرایی‌ها عمداً نیستند
    exts: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv'],
    mimes: [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/plain',
      'text/csv',
    ],
  },
} as const;

export type UploadKind = 'image' | 'video' | 'file';

/** بایتهای جادویی رایج — تقلب MIME/پسوند را می‌گیرد (فایل exe با نام jpg رد) */
export function sniffKind(buf: Buffer): string | null {
  if (buf.length < 4) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf.subarray(0, 4).toString('ascii') === 'GIF8') return 'gif';
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP')
    return 'webp';
  if (buf.subarray(0, 4).toString('ascii') === '%PDF') return 'pdf';
  if (buf.subarray(4, 8).toString('ascii') === 'ftyp') return 'mp4-like'; // mp4 / mov
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'webm-ebml';
  if (buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 3 || buf[2] === 5 || buf[2] === 7))
    return 'zip'; // docx / xlsx / pptx
  if (buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0)
    return 'ole'; // doc / xls / ppt قدیمی
  return null;
}

export interface ValidatedUpload {
  kind: UploadKind;
  ext: string;
  safeName: string;
}

/**
 * ولیدیشن کامل پیوست گفتگو — نام امن + پسوند + MIME + بایت جادویی.
 * خطا → AppError.badRequest (همان پیام‌های چت؛ کلاینت مشترک است).
 */
export function validateConversationUpload(
  buffer: Buffer,
  mimetype: string,
  filename: string,
): ValidatedUpload {
  if (buffer.length === 0) throw AppError.badRequest('فایل خالی است.', 'FILE_EMPTY');
  if (buffer.length > MAX_FILE_BYTES) {
    throw AppError.badRequest('حجم فایل نباید بیشتر از ۵ مگابایت باشد.', 'FILE_TOO_LARGE');
  }

  // نام امن — فقط basename؛ کاراکترهای کنترلی و مسیر حذف
  const safeName =
    filename
      .split(/[/\\]/)
      .pop()!
      .replace(/[\u0000-\u001f<>:"|?*]/g, '')
      .slice(0, 180) || 'فایل';

  const ext = (safeName.includes('.') ? safeName.split('.').pop()! : '').toLowerCase();
  if (!ext || !/^[a-z0-9]{1,9}$/.test(ext)) {
    throw AppError.badRequest('پسوند فایل معتبر نیست.', 'BAD_EXTENSION');
  }

  // پیدا کردن نوع مجاز مطابق پسوند + MIME (هر دو باید بخوانند)
  let kind: UploadKind | null = null;
  for (const [k, rule] of Object.entries(FILE_RULES) as Array<[UploadKind, (typeof FILE_RULES)['image']]>) {
    if ((rule.exts as readonly string[]).includes(ext) && (rule.mimes as readonly string[]).includes(mimetype)) {
      kind = k;
      break;
    }
  }
  if (!kind) {
    throw AppError.badRequest(
      'این نوع فایل مجاز نیست. تصویر (jpg، png، gif، webp)، ویدئو (mp4، webm، mov) یا سند (pdf، آفیس، متن) ارسال کنید.',
      'FILE_TYPE_FORBIDDEN',
    );
  }

  // بایتهای جادویی — تقلب پسوند/MIME را می‌گیرد (گفتگو قابل سوءاستفاده نیست)
  const sniff = sniffKind(buffer);
  if (sniff) {
    const ok =
      (kind === 'image' && ['jpeg', 'png', 'gif', 'webp'].includes(sniff)) ||
      (kind === 'video' && ['mp4-like', 'webm-ebml'].includes(sniff)) ||
      (kind === 'file' &&
        ((ext === 'pdf' && sniff === 'pdf') ||
          (['docx', 'xlsx', 'pptx'].includes(ext) && sniff === 'zip') ||
          (['doc', 'xls', 'ppt'].includes(ext) && sniff === 'ole')));
    if (!ok) {
      throw AppError.badRequest('محتوای فایل با نوع اعلام‌شده نمی‌خواند.', 'FILE_CONTENT_MISMATCH');
    }
  } else if (kind !== 'file') {
    // تصویر/ویدئوی ناشناخته = مشکوک — رد
    throw AppError.badRequest('محتوای فایل معتبر نیست.', 'FILE_CONTENT_MISMATCH');
  }

  return { kind, ext, safeName };
}
