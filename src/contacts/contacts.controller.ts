import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ok } from '../common/api-response';
import { ContactsService } from './contacts.service';
import { ContactIdDto, ImportContactsDto } from './dto';
import type { AuthUser } from '../common/guards';

/** مخاطبین گوشی — «ارسال به مخاطبین» (خواسته مالک ۴-۱۱) */
@ApiTags('contacts')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Throttle({ default: { limit: 30, ttl: 60_000 } })
@Controller('contacts')
export class ContactsController {
  constructor(private readonly contacts: ContactsService) {}

  @Post('import')
  @ApiOperation({ summary: 'لود یک‌بارهٔ مخاطبین گوشی (Contact Picker)' })
  async importContacts(@CurrentUser() user: AuthUser, @Body() dto: ImportContactsDto) {
    return ok(await this.contacts.importContacts(user, dto));
  }

  @Post('getMyContacts')
  @ApiOperation({ summary: 'لیست مخاطبین من + عضویت در ایمچ' })
  async getMyContacts(@CurrentUser() user: AuthUser) {
    return ok(await this.contacts.getMyContacts(user));
  }

  @Post('delete')
  @ApiOperation({ summary: 'حذف یک مخاطب از لیست من' })
  async deleteContact(@CurrentUser() user: AuthUser, @Body() dto: ContactIdDto) {
    return ok(await this.contacts.deleteContact(user, dto.id));
  }
}
