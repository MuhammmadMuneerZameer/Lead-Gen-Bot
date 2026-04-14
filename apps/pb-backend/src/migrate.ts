import { MongoClient } from 'mongodb';
import PocketBase from 'pocketbase';
import dotenv from 'dotenv';
import path from 'path';

/**
 * Data Migration Tool: MongoDB -> PocketBase
 * Extracts all leads and transfers them.
 */
dotenv.config({ path: path.join(__dirname, '../../../.env') });

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/hydrafox';
const PB_URL = process.env.POCKETBASE_URL || 'http://127.0.0.1:8090';
const PB_EMAIL = process.env.POCKETBASE_ADMIN_EMAIL || '';
const PB_PASS = process.env.POCKETBASE_ADMIN_PASSWORD || '';

async function migrate() {
  console.log('📦 Starting Migration: MongoDB -> PocketBase');

  // 1. Connect to both
  const mongo = new MongoClient(MONGO_URI);
  await mongo.connect();
  const db = mongo.db();
  const pb = new PocketBase(PB_URL);
  await pb.admins.authWithPassword(PB_EMAIL, PB_PASS);

  // 2. Migrate Leads
  const leads = await db.collection('leads').find().toArray();
  console.log(`Found ${leads.length} leads in MongoDB.`);

  let migrated = 0;
  for (const mongoLead of leads) {
    try {
      // Check for dupe in PB
      const existing = await pb.collection('leads').getList(1, 1, {
        filter: `domain = "${mongoLead.domain}"`
      });

      if (existing.totalItems > 0) {
        console.log(`Skipping existing lead: ${mongoLead.domain}`);
        continue;
      }

      await pb.collection('leads').create({
        business_name: mongoLead.businessName,
        domain: mongoLead.domain,
        website: mongoLead.website,
        industry: mongoLead.industry,
        industry_tier: mongoLead.industryTier,
        phone: mongoLead.phone,
        email: mongoLead.email,
        social_links: mongoLead.socialLinks,
        score: mongoLead.opportunityScore,
        opportunity_level: mongoLead.opportunityLevel,
        score_breakdown: mongoLead.scoreBreakdown,
        status: mongoLead.status,
        source: mongoLead.source,
        created: mongoLead.createdAt,
      });
      migrated++;
    } catch (err) {
      console.error(`Failed to migrate lead ${mongoLead.domain}:`, (err as Error).message);
    }
  }

  console.log(`✅ Migration Complete: ${migrated} leads ported.`);
  await mongo.close();
}

migrate().catch(console.error);
