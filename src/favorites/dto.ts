import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length } from 'class-validator';

export class ToggleProductFavoriteDto {
  @Type(() => Number)
  @IsInt()
  productId!: number;
}

export class ToggleSellerFavoriteDto {
  /** شناسه عمومی فروشنده (userName مثل wbrstu2g1) */
  @IsString()
  @Length(2, 40)
  userName!: string;
}

export class IsSellerSavedDto {
  @IsString()
  @Length(2, 40)
  userName!: string;
}

export class ListFavoritesDto {
  /** فقط آگهی‌ها یا فقط فروشنده‌ها — خالی = هر دو */
  @IsOptional()
  @IsString()
  kind?: 'products' | 'sellers';
}
