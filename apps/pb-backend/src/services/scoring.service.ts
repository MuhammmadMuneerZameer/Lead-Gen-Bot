import { pb } from '../lib/pb';

/**
 * Scoring Service for HydraFox v3.0 (PocketBase Edition)
 */
export const scoringService = {
  /**
   * Run the scoring logic on a single lead OR all "enriched" leads.
   */
  async run(payload: { leadId?: string; all?: boolean }, jobId: string) {
    if (payload.all) {
      const leads = await pb.collection('leads').getFullList({ filter: 'status = "enriched"' });
      for (const lead of leads) {
        await this.scoreLead(lead);
      }
    } else if (payload.leadId) {
      const lead = await pb.collection('leads').getOne(payload.leadId);
      await this.scoreLead(lead);
    }
  },

  async scoreLead(lead: any) {
    console.log(`[SCORING] Scoring lead: ${lead.business_name} (${lead.domain})`);

    let rawScore = 0;
    const breakdown: Record<string, number> = {};

    // 1. Website Presence (using PocketBase fields)
    if (!lead.website) {
      breakdown['noWebsite'] = 40;
      rawScore += 40;
    } else if (lead.website_quality === 'outdated' || lead.website_quality === 'basic') {
      breakdown['poorWebsite'] = 15;
      rawScore += 15;
    }

    // 2. Email Presence
    if (!lead.email) {
      breakdown['noEmail'] = 25;
      rawScore += 25;
    }

    // 3. Social Presence
    const socialLinks = Array.isArray(lead.social_links) ? lead.social_links : [];
    if (socialLinks.length === 0) {
      breakdown['noSocialPresence'] = 20;
      rawScore += 20;
    }

    // 4. Industry Tier Multiplier
    const tier = lead.industry_tier || 2;
    const tierMultiplier = tier === 3 ? 1.3 : tier === 1 ? 0.5 : 1.0;
    
    if (tierMultiplier !== 1.0) {
      breakdown['tierMultiplier'] = tierMultiplier;
    }

    const finalScore = Math.min(Math.round(rawScore * tierMultiplier), 100);
    const level = finalScore >= 65 ? 'high' : finalScore >= 30 ? 'medium' : 'low';

    // 5. Update Lead in PocketBase
    await pb.collection('leads').update(lead.id, {
      score: finalScore,
      opportunity_level: level,
      score_breakdown: breakdown,
      status: 'reviewed'
    });

    console.log(`[SCORING] Final Score: ${finalScore} (${level})`);
  }
};
