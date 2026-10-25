import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { GatewayModule } from './gateway/gateway.module'
import { AuthModule } from './auth/auth.module'
import { UsersModule } from './users/users.module'
import { ThrottlerModule } from '@nestjs/throttler'
import { APP_GUARD } from '@nestjs/core/constants'
import { ThrottlerByIpGuard } from './auth/guards/throttle-by-ip.guard'
import { Injectable, NestMiddleware, Logger } from '@nestjs/common'
import { Request, Response, NextFunction } from 'express'
import { ScheduleModule } from '@nestjs/schedule'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { BullModule } from '@nestjs/bull'
import { EventEmitterModule } from '@nestjs/event-emitter'

// The Sendline marketing layer.
import { ContactsModule } from './contacts/contacts.module'
import { ListsModule } from './lists/lists.module'
import { TemplatesModule } from './templates/templates.module'
import { CampaignsModule } from './campaigns/campaigns.module'
import { SuppressionModule } from './suppression/suppression.module'
import { EmailModule } from './email/email.module'
import { MessagingModule } from './messaging/messaging.module'
import { InboundModule } from './inbound/inbound.module'

@Injectable()
export class LoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP')

  use(req: Request, res: Response, next: NextFunction) {
    // Method and path only. Bodies carry phone numbers and message text, and
    // those do not belong in a log file.
    this.logger.debug(`${req.method} ${req.originalUrl}`)
    if (next) {
      next()
    }
  }
}

@Module({
  imports: [
    MongooseModule.forRoot(process.env.MONGO_URI),
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    EventEmitterModule.forRoot(),
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 60,
      },
    ]),
    ScheduleModule.forRoot(),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => {
        return {
          redis: configService.get('REDIS_URL'),
        }
      },
    }),
    AuthModule,
    UsersModule,
    GatewayModule,
    ContactsModule,
    ListsModule,
    TemplatesModule,
    SuppressionModule,
    EmailModule,
    CampaignsModule,
    MessagingModule,
    InboundModule,
  ],
  controllers: [],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerByIpGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(LoggerMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL })
  }
}
