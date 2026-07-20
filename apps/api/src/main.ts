import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  // Requests normally arrive same-origin via the web app's /api proxy (Next rewrites),
  // so the session cookie stays first-party. credentials:true keeps direct cross-origin
  // calls (with an explicit WEB_ORIGIN) able to send the cookie too.
  app.enableCors({ origin: process.env.WEB_ORIGIN ?? true, credentials: true });

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
  console.log(`JobRadar API listening on port ${port}`);
}

void bootstrap();
