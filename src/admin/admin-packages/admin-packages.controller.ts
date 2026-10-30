import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminJwtAuthGuard } from '../admin-auth/admin-jwt.guard';
import { AdminId } from '../admin-auth/admin-auth.controller';
import { AdminUsername } from '../admin-wallet/admin-wallet.controller';
import { AdminPackagesService } from './admin-packages.service';
import { ok } from '../../common/api-response';
import {
  DeleteCampaignDto,
  DeletePlanDto,
  GetAdminPackageOrdersDto,
  GetCampaignsDto,
  ReviewAdminPackageOrderDto,
  SetCampaignDiscountDto,
  SetCampaignPurchaseCountDto,
  UpsertCampaignDto,
  UpsertPlanDto,
} from './dto';

/** مدیریت بسته‌های اشتراک و کمپین‌های فروش — منبع واحد (admin/packages/*) */
@ApiTags('admin-packages')
@UseGuards(AdminJwtAuthGuard)
@ApiBearerAuth()
@Throttle({ default: { limit: 60, ttl: 60_000 } })
@Controller('admin/packages')
export class AdminPackagesController {
  constructor(private readonly packages: AdminPackagesService) {}

  // ─── سفارش‌ها (صف فیش‌ها) ────────────────────────────────────────────────

  @Post('getPackageOrders')
  @ApiOperation({ summary: 'صف بررسی فیش‌های بسته — فیلتر وضعیت + صفحه‌بندی' })
  async getPackageOrders(@Body() dto: GetAdminPackageOrdersDto) {
    return ok(await this.packages.getPackageOrders(dto));
  }

  @Post('reviewPackageOrder')
  @ApiOperation({ summary: 'تأیید (بسته فعال/تمدید می‌شود) یا رد با دلیل' })
  async reviewPackageOrder(
    @AdminId() adminId: string,
    @AdminUsername() adminUsername: string,
    @Body() dto: ReviewAdminPackageOrderDto,
  ) {
    return ok(
      await this.packages.reviewPackageOrder(adminId, adminUsername, dto),
      dto.approve ? 'بسته اشتراک کاربر تأیید و فعال شد.' : 'سفارش بسته رد شد.',
    );
  }

  // ─── بسته‌ها (CRUD — خواسته مالک ۳۱-۱۰) ─────────────────────────────────

  @Post('getPlans')
  @ApiOperation({ summary: 'همه بسته‌ها + آمار فروش/جذب هر بسته' })
  async getPlans() {
    return ok(await this.packages.getPlans());
  }

  @Post('upsertPlan')
  @ApiOperation({ summary: 'ساخت/ویرایش بسته — قیمت و ویژگی‌ها قابل تغییر (id خالی = ساخت)' })
  async upsertPlan(@Body() dto: UpsertPlanDto) {
    return ok(
      await this.packages.upsertPlan(dto),
      dto.id ? 'بسته به‌روزرسانی شد.' : 'بسته جدید ساخته شد.',
    );
  }

  @Post('deletePlan')
  @ApiOperation({ summary: 'حذف بسته — اگر سفارش دارد فقط غیرفعال می‌شود' })
  async deletePlan(@Body() dto: DeletePlanDto) {
    return ok(
      await this.packages.deletePlan(dto),
      dto.id ? undefined : undefined,
    );
  }

  // ─── کمپین‌های فروش (خواسته مالک ۳۱-۱۰) ─────────────────────────────────

  @Post('getCampaigns')
  @ApiOperation({ summary: 'لیست کمپین‌ها + وضعیت جاری + شمار خرید هر کمپین' })
  async getCampaigns(@Body() dto: GetCampaignsDto) {
    return ok(await this.packages.getCampaigns(dto));
  }

  @Post('upsertCampaign')
  @ApiOperation({ summary: 'ساخت/ویرایش کمپین زمانی/تعدادی (id خالی = ساخت)' })
  async upsertCampaign(@Body() dto: UpsertCampaignDto) {
    return ok(
      await this.packages.upsertCampaign(dto),
      dto.id ? 'کمپین به‌روزرسانی شد.' : 'کمپین جدید ساخته شد.',
    );
  }

  @Post('deleteCampaign')
  @ApiOperation({ summary: 'حذف کمپین' })
  async deleteCampaign(@Body() dto: DeleteCampaignDto) {
    return ok(await this.packages.deleteCampaign(dto), 'کمپین حذف شد.');
  }

  @Post('setCampaignDiscount')
  @ApiOperation({ summary: 'تغییر سریع درصد تخفیف جاری کمپین (null = خودکار پله‌ای)' })
  async setCampaignDiscount(@Body() dto: SetCampaignDiscountDto) {
    return ok(
      await this.packages.setCampaignDiscount(dto),
      'درصد تخفیف جاری کمپین به‌روزرسانی شد.',
    );
  }

  @Post('setCampaignPurchaseCount')
  @ApiOperation({ summary: 'تغییر سریع شمار دستی/نمایشی خریداران (null = فقط واقعی)' })
  async setCampaignPurchaseCount(@Body() dto: SetCampaignPurchaseCountDto) {
    return ok(
      await this.packages.setCampaignPurchaseCount(dto),
      'شمار خریداران کمپین به‌روزرسانی شد.',
    );
  }
}
