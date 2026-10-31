import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
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

/** سقف دسته‌های دفتر خرید — عملیات فوق‌ساده بماند (خواسته مالک) */
export const BUYER_BOOK_MAX = 15;

/** دوره‌های خرید — ترتیب نمایش در همه‌جا یکسان است: روزانه، هفتگی، ماهیانه، سالیانه، موردی */
export const BUYER_PERIODS = ['daily', 'weekly', 'monthly', 'yearly', 'occasional'] as const;

/** ردیف دفتر خرید — دستهٔ برگ + حداقل حجم + دوره؛ واحد از خود دسته می‌آید */
export class BuyerBookItemDto {
  @Type(() => Number)
  @IsInt()
  categoryId!: number;

  /** حداقل خرید در هر دوره */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000_000)
  volumeMin!: number;

  @IsIn(BUYER_PERIODS)
  period!: string;
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

  /** جستجو در نام کالا/مسیر دسته */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  s?: string;

  /** دوره خرید — ماهیانه | سالیانه | هفتگی | موردی */
  @IsOptional()
  @IsIn(BUYER_PERIODS)
  period?: string;

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

/** شرایط ساختاریافتهٔ تامین (خواستهٔ مالک ۱-۱۱) — پایهٔ مشترک ارسال تکی و
 *  گروهی؛ فیلدهای سوییچی فقط با مقادیر وابسته‌شان معنا دارند و سرویس
 *  ناقص‌بودنشان را با خطای شفاف رد می‌کند. */
export class SupplyOfferTermsDto {
  /** دستهٔ کالا — باید آخرین سطح (برگ) باشد؛ سمت سایت دکمهٔ ارسال فقط با
   *  دستهٔ آخر فعال می‌شود و اینجا هم گیت تکرار می‌شود */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  categoryId?: number;

  /** نوع کالا از زبان فروشنده — مثل «آگریا» برای سیب زمینی (اختیاری) */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  productType?: string;

  /** سوییچ: امکان پرداخت با چک */
  @IsOptional()
  @IsBoolean()
  checkAccepted?: boolean;

  /** درصد مبلغ قابل پرداخت با چک — با checkAccepted الزامی */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(10)
  @Max(100)
  checkPercent?: number;

  /** حداکثر سرسید چک (روز) — با checkAccepted الزامی */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  checkMaxDays?: number;

  /** سوییچ: ارسال به محل خریدار */
  @IsOptional()
  @IsBoolean()
  deliveryToBuyer?: boolean;

  /** پرداخت‌کنندهٔ هزینهٔ حمل — با deliveryToBuyer الزامی */
  @IsOptional()
  @IsIn(['seller', 'customer'])
  shippingCostBy?: string;

  /** حداقل مقدار خرید این پیشنهاد (به واحد دسته) */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000_000)
  minOrderAmount?: number;
}

/** POST /buyers/sendSupplyOffer — پیشنهاد تامین تکی (فروشندهٔ دارندهٔ بسته) */
export class SendSupplyOfferDto extends SupplyOfferTermsDto {
  /** ObjectId خریدار هدف — از دایرکتوری */
  @IsString()
  @Matches(/^[0-9a-fA-F]{24}$/, { message: 'خریدار یافت نشد.' })
  buyerId!: string;

  @IsString()
  @Length(5, 1500)
  message!: string;
}

/** POST /buyers/groupSendSupplyOffer — ارسال گروهی پولی از کیف پول */
export class GroupSendSupplyOfferDto extends SupplyOfferTermsDto {
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

/** POST /buyers/getMyReceivedOffers — پیشنهادهای دریافتی من (پنل خریدار):
 *  فیلتر دسته/نوع کالا/چک/ارسال برای مقایسهٔ آسان‌تر پیشنهادها */
export class GetMyReceivedOffersDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  categoryId?: number;

  /** جستجو در نوع کالا */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  productType?: string;

  /** فقط پیشنهادهایی که چک می‌پذیرند */
  @IsOptional()
  @IsBoolean()
  hasCheck?: boolean;

  /** فقط پیشنهادهایی که ارسال به محل دارند */
  @IsOptional()
  @IsBoolean()
  hasDelivery?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24)
  perPage?: number;
}
