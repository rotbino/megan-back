import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

/**
 * کاربر — نام فیلدها snake_case منطبق با باسکول (جدول myusers) برای مهاجرت آسان داده.
 * پروفایل کامل کسب‌وکار (معادل myuser_profiles باسکول) به‌صورت embedded در همین سند
 * ذخیره می‌شود تا getProfile با یک کوئری سرو شود.
 */
@Schema({ collection: 'users', timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } })
export class User {
  _id?: Types.ObjectId;
  created_at?: Date;
  updated_at?: Date;

  /** شماره موبایل — تنها راه ورود */
  @Prop({ required: true }) phone!: string;

  /** شناسه عمومی پروفایل مثل باسکول (wbrstu2g1) — با اولین تکمیل پروفایل تولید می‌شود */
  @Prop({ type: String, default: null }) user_name?: string | null;

  @Prop({ default: '' }) first_name!: string;
  @Prop({ default: '' }) last_name!: string;

  /** «آقا» / «خانم» — مثل باسکول */
  @Prop({ type: String, default: null }) sex?: string | null;

  @Prop({ default: 'USER' }) role!: string; // USER | SELLER | ADMIN

  @Prop({ default: false }) is_verified!: boolean;
  @Prop({ default: true }) is_buyer!: boolean;
  @Prop({ default: false }) is_seller!: boolean;
  @Prop({ default: 0 }) wallet_balance!: number;

  @Prop({ type: String, default: null }) avatar_url?: string | null;
  @Prop({ type: String, default: null }) business_desc?: string | null;

  /** پروفایل کسب‌وکار embedded — فیلدهای myuser_profiles باسکول */
  @Prop({ type: Object, default: {} }) profile?: Record<string, unknown>;
}

export const UserSchema = SchemaFactory.createForClass(User);
