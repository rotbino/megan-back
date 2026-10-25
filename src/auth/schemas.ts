import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

/**
 * کد یک‌بار مصرف ورود — فقط هش sha256(phone:code) ذخیره می‌شود.
 * سند با رسیدن expires_at به‌صورت خودکار توسط TTL ایندکس مونگو حذف می‌شود.
 */
@Schema({ collection: 'otp_codes', timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } })
export class OtpCode {
  _id?: Types.ObjectId;
  created_at?: Date;

  @Prop({ required: true }) phone!: string;
  @Prop({ required: true }) code_hash!: string;
  @Prop({ type: Date, required: true }) expires_at!: Date;
  @Prop({ default: 0 }) tries!: number;
}

/**
 * رفرش‌توکن چرخشی — فقط هش sha256 ذخیره می‌شود؛ با هر refresh یکی قدیمی
 * باطل (revoked) و یکی جدید ساخته می‌شود. TTL خودکار ۳۰ روز.
 */
@Schema({ collection: 'refresh_tokens', timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } })
export class RefreshToken {
  _id?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true }) user_id!: Types.ObjectId;
  @Prop({ required: true }) token_hash!: string;
  @Prop({ default: false }) revoked!: boolean;
  @Prop({ type: Date, required: true }) expires_at!: Date;
}

export const OtpCodeSchema = SchemaFactory.createForClass(OtpCode);
export const RefreshTokenSchema = SchemaFactory.createForClass(RefreshToken);
