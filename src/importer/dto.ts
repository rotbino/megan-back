import { IsInt, IsOptional, IsString, Length, Max, Min, Matches } from 'class-validator';

/** گوشهٔ امن ایمپورتر — فقط این شمارهٔ ادمین اجازهٔ عملیات مخرب دارد */
export const importerAdminPhone = () =>
  (process.env.IMPORTER_ADMIN_PHONE ?? '09196421264').trim();

export class CleanupDto {
  @Matches(/^09\d{9}$/, { message: 'شماره ادمین نامعتبر است' })
  adminPhone!: string;
}

export class SingleImportDto {
  @Matches(/^09\d{9}$/, { message: 'شماره ادمین نامعتبر است' })
  adminPhone!: string;

  @IsString()
  @Length(2, 64)
  userName!: string;

  @IsOptional()
  @Matches(/^09\d{9}$/, { message: 'شماره موبایل باید مثل 09123456789 باشد' })
  phone?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  maxProducts?: number;
}

export class ListImportDto {
  @Matches(/^09\d{9}$/, { message: 'شماره ادمین نامعتبر است' })
  adminPhone!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  offset?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(500)
  maxProductsPerUser?: number;
}

export class StopJobDto {
  @Matches(/^09\d{9}$/, { message: 'شماره ادمین نامعتبر است' })
  adminPhone!: string;
}
