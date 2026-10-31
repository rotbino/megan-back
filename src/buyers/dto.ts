import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** واحدهای مجاز دفتر خرید */
export const BUYER_UNITS = ['کیلوگرم', 'تن', 'عدد', 'بسته', 'لیتر', 'متر'] as const;

/** سقف دسته‌های دفتر خرید — عملیات فوق‌ساده بماند (خواسته مالک) */
export const BUYER_BOOK_MAX = 15;

/** ردیف دفتر خرید — دستهٔ برگ + بازهٔ حجم خرید ماهانه */
export class BuyerBookItemDto {
  @Type(() => Number)
  @IsInt()
  categoryId!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000_000)
  volumeMin!: number;

  /** 0 = بدون سقف («بیشتر») */
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000_000)
  volumeMax!: number;

  @IsIn(BUYER_UNITS)
  unit!: string;
}

/** POST /buyers/saveMyBook — جایگزینی کامل دفتر خرید من */
export class SaveMyBookDto {
  @IsArray()
  @ArrayMaxSize(BUYER_BOOK_MAX)
  @ValidateNested({ each: true })
  @Type(() => BuyerBookItemDto)
  items!: BuyerBookItemDto[];
}

/** POST /buyers/directory — دایرکتوری عمومی خریداران (فیلتر مثل لیست آگهی‌ها) */
export class GetBuyerDirectoryDto {
  /** دسته — برگ یا شاخه (زیر‌شاخه‌ها هم شامل می‌شوند) */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  categoryId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  provinceId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  cityId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(48)
  perPage?: number;
}

/** POST /buyers/sendSupplyOffer — پیشنهاد تامین تکی (فروشندهٔ دارندهٔ بسته) */
export class SendSupplyOfferDto {
  /** ObjectId خریدار هدف — از دایرکتوری */
  @IsString()
  @Matches(/^[0-9a-fA-F]{24}$/, { message: 'خریدار یافت نشد.' })
  buyerId!: string;

  @IsString()
  @Length(5, 1500)
  message!: string;
}

/** POST /buyers/groupSendSupplyOffer — ارسال گروهی پولی از کیف پول */
export class GroupSendSupplyOfferDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @Matches(/^[0-9a-fA-F]{24}$/, { each: true, message: 'خریدار یافت نشد.' })
  buyerIds!: string[];

  @IsString()
  @Length(5, 1500)
  message!: string;
}
