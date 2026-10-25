import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

/**
 * مکان‌ها — مثل باسکول: ۳۱ استان + شهرها. `_id` همان عدد باسکول
 * (اصفهان=4، کرمان=21، شهر بابک=230) — با seed از API عمومی باسکول پر می‌شود.
 */
@Schema({ collection: 'provinces' })
export class Province {
  _id?: number;

  @Prop({ required: true }) province_name!: string;
  @Prop({ type: String, default: null }) province_en_name?: string | null;
  @Prop({ default: 1 }) country_id!: number;
  @Prop({ type: String, default: null }) latitude?: string | null;
  @Prop({ type: String, default: null }) longitude?: string | null;
}

@Schema({ collection: 'cities' })
export class City {
  _id?: number;

  @Prop({ required: true }) province_id!: number;
  @Prop({ required: true }) city_name!: string;
  @Prop({ type: String, default: null }) city_en_name?: string | null;
  @Prop({ type: String, default: null }) latitude?: string | null;
  @Prop({ type: String, default: null }) longitude?: string | null;
}

export const ProvinceSchema = SchemaFactory.createForClass(Province);
export const CitySchema = SchemaFactory.createForClass(City);
