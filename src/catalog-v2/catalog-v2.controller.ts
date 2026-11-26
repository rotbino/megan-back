import { Body, Controller, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, Length } from 'class-validator';
import { AdsReportService } from '../admin/ads-report/ads-report.service';
import { GetCatalogListDto } from '../admin/ads-report/dto';
import { CategoriesService } from '../categories/categories.service';
import { isTaxonomyKey, v2KeyForBuskol, v2PathForKey } from '../common/taxonomy';
import { ok } from '../common/api-response';

/**
 * ورودی resolveSlug — slug یا نام فارسی دستهٔ باسکول از URLهای قدیمی
 */
class ResolveSlugDto {
  @IsOptional()
  @IsString()
  @Length(1, 120)
  slug?: string;
}

@ApiTags('catalog-v2')
@Throttle({ default: { limit: 60, ttl: 60_000 } })
@Controller('catalog/v2')
export class CatalogV2Controller {
  constructor(
    private readonly report: AdsReportService,
    private readonly categories: CategoriesService,
  ) {}

  @Post('getTree')
  @ApiOperation({ summary: 'درخت عمیق v2 + شمار آگهی confirmed هر گره' })
  async getTree() {
    return ok(await this.report.getTree());
  }

  @Post('getList')
  @ApiOperation({ summary: 'آگهی‌های confirmed روی دستهٔ جدید — فیلتر گره/شهر/جستجو/اتریبیوت/سورت' })
  async getList(@Body() dto: GetCatalogListDto) {
    return ok(await this.report.getPublicList(dto));
  }

  /** (۲۶-۱۱) سوییچ عمومی سایت به تاکسونومی ایمچ — ریدایرکت یکتای لینک‌های
   *  قدیمی: slug/نام باسکول → کلید v2؛ فرانت با آن ۳۰۱ دائمی می‌زند تا اعتبار
   *  سئوی URLهای ایندکس‌شده به دستهٔ جدید منتقل شود. null = دسته ناشناخته → 404 */
  @Post('resolveSlug')
  @ApiOperation({ summary: 'دسته باسکول کهنه → کلید v2 (برای ریدایرکت دائمی) — خروجی key=null یعنی 404' })
  async resolveSlug(@Body() dto: ResolveSlugDto) {
    const slug = (dto.slug ?? '').trim();
    if (!slug) return ok({ key: null, path: [] as string[] });
    // خودش کلید v2 است؟ مستقیم جواب بده
    if (isTaxonomyKey(slug)) {
      return ok({ key: slug, path: v2PathForKey(slug) });
    }
    // slug/نام باسکول → نود درخت باسکول (اولین id = خود دسته) → کلید v2
    const ids = await this.categories.getSubtreeIds(slug);
    const buskolId = ids[0];
    const names = await this.categories.getNameMap();
    const key = buskolId != null ? v2KeyForBuskol(buskolId, names.get(buskolId)?.category_name ?? null) : null;
    return ok({ key, path: v2PathForKey(key) });
  }
}
