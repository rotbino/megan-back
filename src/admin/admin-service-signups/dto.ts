import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Length, Min } from 'class-validator';
import { SERVICE_IDS } from '../../service-signups/dto';

/** POST /admin/service-signups/getSignupList — فهرست ثبت‌نام‌های سرویس‌های تخصصی */
export class GetSignupListDto {
  /** جستجو: نام کسب‌وکار، صنف یا مشخصات ثبت‌نام‌کننده */
  @IsOptional()
  @IsString()
  @Length(1, 60)
  search?: string;

  @IsOptional()
  @IsIn(SERVICE_IDS as unknown as string[])
  serviceId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  perPage?: number;
}
