import { Module } from '@nestjs/common';
import { AuthModule } from '@novan/api-auth';
import { ContentModule } from '@novan/api-content';
import { MeController } from './me.controller';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';
import { SpaceController } from './space.controller';
import { SpacesController } from './spaces.controller';
import { SpacesService } from './spaces.service';

@Module({
  imports: [AuthModule, ContentModule],
  controllers: [MeController, SpacesController, SpaceController, MembersController],
  providers: [SpacesService, MembersService],
})
export class SpacesModule {}
