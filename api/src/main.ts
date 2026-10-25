import 'dotenv/config'
import { VersioningType, Logger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import * as firebase from 'firebase-admin'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { NestExpressApplication } from '@nestjs/platform-express'

// Global error handlers to prevent server crashes
const logger = new Logger('GlobalErrorHandler')

process.on('uncaughtException', (error: Error) => {
  logger.error('Uncaught Exception:', error.stack || error.message)
  // Don't exit the process for uncaught exceptions in production
  // process.exit(1)
})

process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason)
})

async function bootstrap() {
  const app: NestExpressApplication = await NestFactory.create(AppModule)
  const PORT = process.env.PORT || 3001

  app.setGlobalPrefix('api')
  app.enableVersioning({
    defaultVersion: '1',
    type: VersioningType.URI,
  })

  const config = new DocumentBuilder()
    .setTitle('SelfhostSIM API Docs')
    .setDescription('SelfhostSIM - Android SMS Gateway API Docs')
    .setVersion('1.0')
    .addBearerAuth()
    .addApiKey({
      type: 'apiKey',
      name: 'x-api-key',
      in: 'header',
    })
    .build()
  const document = SwaggerModule.createDocument(app, config)
  SwaggerModule.setup('', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
    },
  })

  // Firebase is only needed to PUSH a send job to the phone. Everything else -
  // login, contacts, lists, templates, campaign building, the whole UI - works
  // without it, and phase 2 removes it entirely in favour of the phone polling
  // over Tailscale.
  //
  // So initialise it only when it is actually configured. `credential.cert()`
  // throws on an empty projectId, and that throw used to happen before
  // `app.listen()`, leaving a container that was up but served nothing. A
  // half-filled .env should not cost you the admin UI.
  if (
    process.env.FIREBASE_PROJECT_ID &&
    process.env.FIREBASE_PRIVATE_KEY &&
    process.env.FIREBASE_CLIENT_EMAIL
  ) {
    const firebaseConfig = {
      type: 'service_account',
      projectId: process.env.FIREBASE_PROJECT_ID,
      privateKeyId: process.env.FIREBASE_PRIVATE_KEY_ID,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      clientId: process.env.FIREBASE_CLIENT_ID,
      authUri: 'https://accounts.google.com/o/oauth2/auth',
      tokenUri: 'https://oauth2.googleapis.com/token',
      authProviderX509CertUrl: 'https://www.googleapis.com/oauth2/v1/certs',
      clientC509CertUrl: process.env.FIREBASE_CLIENT_C509_CERT_URL,
    }

    firebase.initializeApp({
      credential: firebase.credential.cert(firebaseConfig),
    })
    logger.log('Firebase initialised; SMS push to the phone is available.')
  } else {
    logger.warn(
      'FIREBASE_* is not set. The API will start and the UI will work, but ' +
        'sending an SMS to the phone will fail until you fill it in.',
    )
  }

  app.useBodyParser('json', { limit: '2mb' })
  app.enableCors()
  await app.listen(PORT)
}
bootstrap()
