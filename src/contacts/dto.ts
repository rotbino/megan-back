import { ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsOptional, IsString, Length, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

/** یک مخاطب گوشی — نام نمایشی + شماره (نرمال‌سازی سمت سرور) */
export class ContactInputDto {
  @ApiPropertyOptional({ description: 'نام ذخیره‌شده در گوشی' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;

  @IsString()
  @Length(1, 32)
  phone!: string;
}

/** POST /contacts/import — لود یک‌بارهٔ مخاطبین گوشی در ایمچ */
export class ImportContactsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2000, { message: 'هر ارسال حداکثر ۲۰۰۰ مخاطب دارد.' })
  @ValidateNested({ each: true })
  @Type(() => ContactInputDto)
  items!: ContactInputDto[];
}

/** DELETE /contacts/:id — حذف یک مخاطب از لیست من */
export class ContactIdDto {
  @IsString()
  @Length(1, 40)
  id!: string;
}
