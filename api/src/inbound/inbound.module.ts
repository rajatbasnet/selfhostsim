import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { Device, DeviceSchema } from '../gateway/schemas/device.schema'
import { SuppressionModule } from '../suppression/suppression.module'
import { InboundSmsListener } from './inbound-sms.listener'

/**
 * The seam between the gateway and the opt-out layer. Deliberately tiny: it
 * exists so neither of those two modules has to import the other.
 */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: Device.name, schema: DeviceSchema }]),
    SuppressionModule,
  ],
  providers: [InboundSmsListener],
})
export class InboundModule {}
