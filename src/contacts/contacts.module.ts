import { Module } from '@nestjs/common';
import { ContactsController } from './contacts.controller';
import { ContactsService } from './contacts.service';
import { AuthModule } from '../auth/auth.module';

/** ماژول مخاطبین گوشی — «ارسال به مخاطبین» (۴-۱۱) */
@Module({
  imports: [AuthModule],
  controllers: [ContactsController],
  providers: [ContactsService],
})
export class ContactsModule {}
