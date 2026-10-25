import { Module } from '@nestjs/common';
import { MongooseModule, SchemaFactory } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { User } from './schemas';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [
    AuthModule, // برای JwtAuthGuard
    MongooseModule.forFeature([
      { name: User.name, schema: SchemaFactory.createForClass(User) },
    ]),
  ],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
