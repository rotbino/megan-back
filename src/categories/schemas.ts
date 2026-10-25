import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

/**
 * درخت دسته‌بندی سه‌سطحی باسکول (کشاورزی ← خشکبار ← پسته) + «نوع کالا».
 * `_id` همان عدد باسکول است (پسته=44) — با seed از APIهای عمومی باسکول پر می‌شود.
 */
@Schema({ collection: 'categories', timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } })
export class Category {
  _id?: number;
  created_at?: Date;
  updated_at?: Date;

  @Prop({ required: true }) category_name!: string;

  /** URL فارسی‌پسند مثل باسکول: /product-list/category/پسته */
  @Prop({ required: true }) slug!: string;

  /** CATEGORY = نود دسته | PRODUCT_TYPE = «نوع کالا» (فرزند برگ؛ ورودی آزاد کاربر) */
  @Prop({ default: 'CATEGORY' }) kind!: string;

  @Prop({ default: 'کیلوگرم' }) unit!: string;
  @Prop({ default: 100 }) min!: number;
  @Prop({ type: String, default: null }) example?: string | null;
  @Prop({ type: Number, default: null }) parent_id!: number | null;

  /** وزن مرتب‌سازی (باسکول: میوه خشک=8272) */
  @Prop({ default: 0 }) score!: number;
}

export const CategorySchema = SchemaFactory.createForClass(Category);
