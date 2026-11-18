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
      1, // supports_vision: 1 (multimodal / image analysis supported)
      1
    );

    const modelRow = db.prepare("SELECT id FROM models WHERE platform = '100milionseek' AND model_id = 'deepseek-v4.1-flash-free'").get() as { id: number } | undefined;
    if (modelRow) {
      const fbExists = db.prepare("SELECT 1 FROM fallback_config WHERE model_db_id = ?").get(modelRow.id);
      if (!fbExists) {
        const maxPriority = (db.prepare('SELECT COALESCE(MAX(priority), 0) AS mx FROM fallback_config').get() as { mx: number }).mx;
        db.prepare('INSERT INTO fallback_config (model_db_id, priority, enabled) VALUES (?, ?, 1)').run(modelRow.id, maxPriority + 1);
      }
      const profiles = db.prepare("SELECT id FROM profiles WHERE auto_include_new_models = 1").all() as { id: number }[];
      const pmExists = db.prepare("SELECT 1 FROM profile_models WHERE profile_id = ? AND model_db_id = ?");
      const pmMaxPriority = db.prepare("SELECT COALESCE(MAX(priority), 0) AS mx FROM profile_models WHERE profile_id = ?");
      for (const p of profiles) {
        if (!pmExists.get(p.id, modelRow.id)) {
          const mx = (pmMaxPriority.get(p.id) as { mx: number }).mx;
          db.prepare('INSERT INTO profile_models (profile_id, model_db_id, priority, enabled) VALUES (?, ?, ?, 1)').run(p.id, modelRow.id, mx + 1);
        }
      }
    }
  } catch (err: any) {
    console.warn('[migration] Could not seed 100milionseek models:', err.message);
  }
}

export function down(db: Db): void {
  try {
    db.prepare("DELETE FROM models WHERE platform = '100milionseek'").run();
  } catch {}
}
