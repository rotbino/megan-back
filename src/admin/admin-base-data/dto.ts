import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

/** نوع گره لوکیشن — همان type های کالکشن Location */
export enum LocationType {
  Province = 'province',
  City = 'city',
}

export class UpsertCategoryDto {
  /** موجود = ویرایش؛ خالی = ایجاد */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  id?: number;

  @IsString()
  @Length(2, 80, { message: 'نام دسته باید بین ۲ تا ۸۰ نویسه باشد.' })
  categoryName!: string;

  /** دسته والد — خالی = ریشه (فقط هنگام ایجاد) */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  parentId?: number | null;

  @IsOptional()
  @IsString()
  @Length(1, 30)
  unit?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0, { message: 'حداقل سفارش معتبر نیست.' })
  min?: number;

  @IsOptional()
  @IsString()
  @Length(1, 60)
  example?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000)
  score?: number;
}

export class DeleteCategoryDto {
  @Type(() => Number)
  @IsInt()
  id!: number;
}

export class GetGoodsDto {
  /** فیلتر دسته برگ */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  categoryId?: number;

  /** جستجو در نام نوع */
  @IsOptional()
  @IsString()
  @Length(1, 80)
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  perPage?: number;
}

export class DeleteGoodDto {
  @Type(() => Number)
  @IsInt()
  id!: number;
}

export class UpsertLocationDto {
  /** buskolId موجود = ویرایش؛ خالی = ایجاد (id تازه از Counter) */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  buskolId?: number;

  @IsEnum(LocationType, { message: 'نوع مکان باید استان یا شهر باشد.' })
  type!: LocationType;

  @IsString()
  @Length(2, 50, { message: 'نام مکان باید بین ۲ تا ۵۰ نویسه باشد.' })
  name!: string;

  @IsOptional()
  @IsString()
  @Length(1, 50)
  enName?: string;

  /** برای شهر: buskolId استان والد */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  parentId?: number;
}

export class SetLocationActiveDto {
  @Type(() => Number)
  @IsInt()
  buskolId!: number;

  @IsEnum(LocationType)
  type!: LocationType;

  @IsBoolean()
  active!: boolean;
}
