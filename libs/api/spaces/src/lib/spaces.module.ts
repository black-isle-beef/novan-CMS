import { Module } from '@nestjs/common';
import { AuthModule } from '@novan/api-auth';
import { MeController } from './me.controller';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';
import { SpacesController } from './spaces.controller';
import { SpacesService } from './spaces.service';

@Module({
  imports: [AuthModule],
  controllers: [MeController, SpacesController, MembersController],
  providers: [SpacesService, MembersService],
})
export class SpacesModule {}
