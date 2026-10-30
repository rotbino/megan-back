/** ورودی‌های ماژول بسته‌ها — فعلاً فقط اینترفیس داخلی صف ادمین */

export interface GetPackageOrdersDto {
  status?: 'pending' | 'approved' | 'rejected';
  page?: number;
  perPage?: number;
}
