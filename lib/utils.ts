import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * 將斷線分鐘數自動換算為人性化時間單位：
 * - < 60 分鐘：X分
 * - < 24 小時：X小時Y分
 * - >= 24 小時 且 < 30 天：X天Y小時
 * - >= 30 天 且 < 365 天：X個月Y天
 * - >= 365 天：X年Y個月（或 X年Y天）
 */
export function formatOfflineDuration(mins: number, isEn: boolean = false, lastSeen?: string | null): string {
  if (mins === 99999 && !lastSeen) {
    return isEn ? "No data" : "從未上傳";
  }
  if (mins < 0) {
    return "—";
  }
  if (mins < 60) {
    return isEn ? `${mins}m` : `${mins}分`;
  }

  const totalHours = Math.floor(mins / 60);
  const remainingMins = mins % 60;

  // 小於 24 小時：顯示 X小時Y分
  if (totalHours < 24) {
    if (isEn) {
      return remainingMins > 0 ? `${totalHours}h ${remainingMins}m` : `${totalHours}h`;
    }
    return remainingMins > 0 ? `${totalHours}小時${remainingMins}分` : `${totalHours}小時`;
  }

  const totalDays = Math.floor(totalHours / 24);
  const remHours = totalHours % 24;

  // 小於 30 天 (以 24小時 為一天)：顯示 X天Y小時
  if (totalDays < 30) {
    if (isEn) {
      return remHours > 0 ? `${totalDays}d ${remHours}h` : `${totalDays}d`;
    }
    return remHours > 0 ? `${totalDays}天${remHours}小時` : `${totalDays}天`;
  }

  // 小於 365 天 (以 30天 為一個月)：顯示 X個月Y天
  if (totalDays < 365) {
    const months = Math.floor(totalDays / 30);
    const remDays = totalDays % 30;
    if (isEn) {
      return remDays > 0 ? `${months}mo ${remDays}d` : `${months}mo`;
    }
    return remDays > 0 ? `${months}個月${remDays}天` : `${months}個月`;
  }

  // 超過 1 年 (以 365天 為一年)：顯示 X年Y個月
  const years = Math.floor(totalDays / 365);
  const remDaysInYear = totalDays % 365;
  const remMonths = Math.floor(remDaysInYear / 30);
  const finalRemDays = remDaysInYear % 30;

  if (isEn) {
    if (remMonths > 0) return `${years}y ${remMonths}mo`;
    if (finalRemDays > 0) return `${years}y ${finalRemDays}d`;
    return `${years}y`;
  }

  if (remMonths > 0) {
    return `${years}年${remMonths}個月`;
  }
  if (finalRemDays > 0) {
    return `${years}年${finalRemDays}天`;
  }
  return `${years}年`;
}

