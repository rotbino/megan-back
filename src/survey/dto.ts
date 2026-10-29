import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** پنج گزینه نظرسنجی — عین MHTML باسکول (عالی تا خیلی بد) */
export const SURVEY_SCORES = ['excellent', 'good', 'average', 'bad', 'very_bad'] as const;
export type SurveyScore = (typeof SURVEY_SCORES)[number];

export class SubmitSurveyDto {
  @ApiProperty({ enum: SURVEY_SCORES, description: 'امتیاز عملکرد ایمچ' })
  @IsIn(SURVEY_SCORES as unknown as string[], { message: 'امتیاز نظرسنجی معتبر نیست.' })
  score: SurveyScore;

  @ApiPropertyOptional({ description: 'متن دلخواه (چه خوب بود؟ چه چیزی بهتر شود؟)', maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  note?: string;
}
