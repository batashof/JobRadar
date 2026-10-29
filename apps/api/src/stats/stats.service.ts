import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { isOwnerRole } from '@jobradar/shared';
import { sql } from 'drizzle-orm';

import { type BotMessageContext, BotService } from '../bot/bot.service';
import { DB, type Database } from '../db/db.module';
import { renderStats, type StatsSnapshot, statsText } from './stats-logic';

const DAY_MS = 24 * 60 * 60_000;

/** How many source tags and failure places `/stats` lists. */
const TOP_SOURCES = 8;
const TOP_ERRORS = 3;

type Row = Record<string, unknown>;

/** Postgres `count(*)` is a bigint, which node-postgres hands back as a string. */
const num = (value: unknown): number => Number(value ?? 0) || 0;

/**
 * The owner's `/stats` in the bot (v2.6.0): how many people use JobRadar,
 * where they drop out of the sign-up funnel, where they came from and what
 * broke. Counted from the tables the product already keeps plus `events`;
 * nothing leaves the database, no analytics service (ADR-001).
 */
@Injectable()
export class StatsService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly bot: BotService,
  ) {}

  onModuleInit(): void {
    this.bot.registerCommand('stats', (ctx) => this.show(ctx));
  }

  async show(ctx: BotMessageContext): Promise<void> {
    if (!isOwnerRole(ctx.role)) {
      await this.bot.sendToUser(ctx.userId, statsText(ctx.language, 'ownerOnly'));
      return;
    }
    await this.bot.sendToUser(ctx.userId, renderStats(await this.snapshot(), ctx.language));
  }

  async snapshot(now: Date = new Date()): Promise<StatsSnapshot> {
    const day = new Date(now.getTime() - DAY_MS);
    const week = new Date(now.getTime() - 7 * DAY_MS);

    // `u` is every account but the author's, so test runs of the owner never
    // inflate the funnel. One round trip for all the counters.
    const { rows: counters } = await this.db.execute(sql`
      with u as (select id, created_at, last_seen_at from users where role <> 'owner')
      select
        (select count(*) from u) as total,
        (select count(*) from u where created_at >= ${day}) as new1d,
        (select count(*) from u where created_at >= ${week}) as new7d,
        (select count(*) from u where last_seen_at >= ${week}) as active7d,
        (select count(*) from u join telegram_accounts t on t.user_id = u.id
          where t.chat_id is not null) as reachable,
        (select count(distinct r.user_id) from resumes r join u on u.id = r.user_id) as resume,
        (select count(*) from candidate_profiles c join u on u.id = c.user_id
          where c.source = 'manual') as manual,
        (select count(*) from candidate_profiles c join u on u.id = c.user_id
          where c.confirmed_at is not null) as confirmed,
        (select count(distinct d.user_id) from digest_items d join u on u.id = d.user_id) as received,
        (select count(distinct a.user_id) from applications a join u on u.id = a.user_id) as applied,
        (select count(*) from digest_items d join u on u.id = d.user_id
          where d.sent_at >= ${week}) as cards7d,
        (select count(distinct d.user_id) from digest_items d join u on u.id = d.user_id
          where d.sent_at >= ${week}) as recipients7d,
        (select count(*) from events where name = 'resume_analyzed'
          and props->>'source' = 'fallback' and created_at >= ${week}) as fallback7d,
        (select count(*) from events where name = 'bot_blocked' and created_at >= ${week}) as blocked7d,
        (select count(*) from events where name = 'account_deleted' and created_at >= ${week}) as deleted7d,
        (select count(*) from events where name = 'account_deleted') as deleted_total,
        (select count(*) from events where name = 'feedback' and created_at >= ${week}) as feedback7d,
        (select count(*) from events where name = 'error' and created_at >= ${day}) as errors1d,
        (select count(*) from events where name = 'error' and created_at >= ${week}) as errors7d
    `);
    const { rows: sources } = await this.db.execute(sql`
      select props->>'source' as source, count(*) as count from events
      where name = 'start' group by 1 order by 2 desc, 1 limit ${TOP_SOURCES}
    `);
    const { rows: errors } = await this.db.execute(sql`
      select props->>'where' as place, count(*) as count from events
      where name = 'error' and created_at >= ${week} group by 1 order by 2 desc, 1 limit ${TOP_ERRORS}
    `);

    const c: Row = counters[0] ?? {};
    return {
      users: {
        total: num(c.total),
        new1d: num(c.new1d),
        new7d: num(c.new7d),
        active7d: num(c.active7d),
        reachable: num(c.reachable),
      },
      funnel: {
        resume: num(c.resume),
        manual: num(c.manual),
        confirmed: num(c.confirmed),
        received: num(c.received),
        applied: num(c.applied),
      },
      week: {
        cards: num(c.cards7d),
        recipients: num(c.recipients7d),
        fallbackResumes: num(c.fallback7d),
        blocked: num(c.blocked7d),
        deleted: num(c.deleted7d),
        feedback: num(c.feedback7d),
      },
      deletedTotal: num(c.deleted_total),
      sources: (sources as Row[]).map((r) => ({
        source: typeof r.source === 'string' ? r.source : null,
        count: num(r.count),
      })),
      errors: {
        day: num(c.errors1d),
        week: num(c.errors7d),
        top: (errors as Row[]).map((r) => ({ where: String(r.place ?? '?'), count: num(r.count) })),
      },
    };
  }
}
