// Migration: Seed 100milionseek provider and deepseek-v4.1-flash-free model
// Created: 2026-11-18

import type { Db } from '../types.js';

export function up(db: Db): void {
  try {
    const insert = db.prepare(`
      INSERT OR IGNORE INTO models (
        platform, model_id, display_name, intelligence_rank, speed_rank,
        size_label, rpm_limit, rpd_limit, tpm_limit, tpd_limit,
        monthly_token_budget, context_window, enabled, supports_vision, supports_tools
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insert.run(
      '100milionseek',
      'deepseek-v4.1-flash-free',
      'DeepSeek V4.1 Flash Free (100milionseek)',
      3,
      9,
      'Frontier',
      null, // Up to 5 concurrent requests
      null,
      null,
      100_000_000, // 100M tokens/day
      '~3B (100M/day)',
      198000,
      1,
      0,
      1
    );
  } catch (err: any) {
    console.warn('[migration] Could not seed 100milionseek models:', err.message);
  }
}

export function down(db: Db): void {
  try {
    db.prepare("DELETE FROM models WHERE platform = '100milionseek'").run();
  } catch {}
}
