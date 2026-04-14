import { pb } from '../lib/pb';
import { scoringService } from './scoring.service';

/**
 * Enrichment Service for HydraFox v3.0 (PocketBase Edition)
 */
export const enrichmentService = {
  /**
   * Run the enrichment logic on a single lead.
   */
  async run(payload: { leadId: string; domain: string; website?: string }, jobId: string) {
    const lead = await pb.collection('leads').getOne(payload.leadId);
    console.log(`[ENRICHMENT] Enriching lead: ${lead.business_name} (${lead.domain})`);

    // 1. (Abstracted) Perform enrichment logic
    // This part should visit website, extract phone/email/socials
    const enrichmentData = await this.performEnrichment(lead.website, lead.domain);
    console.log(`[ENRICHMENT] Enrichment complete: ${enrichmentData.email || 'no email'} / ${enrichmentData.phone || 'no phone'}`);

    // Update lead in PocketBase
    await pb.collection('leads').update(payload.leadId, {
      ...enrichmentData,
      status: 'enriched',
    });

    // 2. Trigger automatic scoring after enrichment
    await scoringService.scoreLead(await pb.collection('leads').getOne(payload.leadId));
  },

  /**
   * Simulation of the Playwright/Cheerio enrichment logic
   */
  async performEnrichment(website: string, domain: string) {
    // Note: Actual enrichment logic would involve visiting the site
    // and extracting contact info if it's not present.

    // Return sample results for demonstration
    return {
      email: domain.includes('zameer') ? 'info@zameer.com' : '',
      phone: '+92 321 0000 000',
      social_links: domain.includes('zameer') ? ['facebook.com/zameerdental'] : [],
      website_quality: website ? 'basic' : 'unknown'
    };
  }
};
