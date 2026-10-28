/**
 * نگهدارنده نمونه socket.io — در main.ts بعد از register(fastify-socket.io)
 * به سرور وصل می‌شود. سرویس چت از طریق emitToUser پیام تازه را به گیرنده
 * می‌رساند؛ اگر WS در دسترس نباشد (مثلاً پلاگین خاموش) فراخوانی no-op است —
 * چت همچنان از مسیر REST + refetch کلاینت کار می‌کند (تنزل تدریجی).
 */

type ServerLike = {
  to: (room: string) => { emit: (event: string, payload: unknown) => void };
  /** ساختار socket.io برای بررسی حضور آنلاین — اختیاری چون نمونه تزئین‌شده است */
  sockets?: { adapter?: { rooms?: Map<string, Set<unknown>> } };
};

let io: ServerLike | null = null;

export function setIo(instance: unknown): void {
  io = (instance as ServerLike) ?? null;
}

export function getIo(): ServerLike | null {
  return io;
}

/** رویدادهای WS چت — قرارداد ثابت کلاینت/سرور */
export const CHAT_EVENTS = {
  /** پیام جدید برای گیرنده */
  NEW_MESSAGE: 'chat:newMessage',
  /** تأیید خواندن پیام‌های ارسالی فرستنده */
  READ: 'chat:read',
  /** پیام مستقیم پشتیبانی (ادمین → کاربر) برای گیرنده */
  ADMIN_MESSAGE: 'chat:adminMessage',
} as const;

/** ارسال رویداد به اتاق شخصی کاربر — بی‌خطر وقتی io نیست */
export function emitToUser(userId: string, event: string, payload: unknown): void {
  try {
    io?.to(`user:${userId}`).emit(event, payload);
  } catch {
    /* WS هرگز نباید مسیر REST را بشکند */
  }
}

/** کاربر الان با سوکت وصل است؟ (برای تصمیم وب‌پوش — آفلاین‌ها اعلان می‌گیرند) */
export function isUserOnline(userId: string): boolean {
  try {
    const room = io?.sockets?.adapter?.rooms?.get(`user:${userId}`);
    return Boolean(room && room.size > 0);
  } catch {
    return false;
  }
}
