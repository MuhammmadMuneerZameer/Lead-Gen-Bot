import { pb } from '../lib/pb';
import OpenAI from 'openai';

/**
 * AI Service for HydraFox v3.0 (PocketBase Edition)
 */
export const aiService = {
  MAJOR_CITIES: [
    'Karachi', 'Lahore', 'Islamabad', 'Rawalpindi', 
    'Faisalabad', 'Multan', 'Hyderabad', 'Peshawar', 'Quetta'
  ],

  /**
   * Expands a keyword into multiple location-based queries.
   */
  async expandQuery(payload: { queryId: string }, jobId: string) {
    const query = await pb.collection('queries').getOne(payload.queryId);
    console.log(`[AI] Expanding query: ${query.keyword}`);

    const expandedQueries = new Set<string>();
    
    // 1. Keyword + Major Cities
    const cities = [...this.MAJOR_CITIES]
      .sort(() => 0.5 - Math.random())
      .slice(0, 5);
      
    cities.forEach(city => {
      expandedQueries.add(`${query.keyword} in ${city}`);
      expandedQueries.add(`best ${query.keyword} ${city}`);
    });
    
    // 2. Extra intent
    expandedQueries.add(`${query.keyword} no website`);
    expandedQueries.add(`local ${query.keyword} services`);

    const results = Array.from(expandedQueries);

    // Update query in PocketBase
    await pb.collection('queries').update(payload.queryId, {
      expanded_queries: results,
      status: 'processed'
    });

    console.log(`[AI] Query expansion complete: ${results.length} variations generated`);

    // 3. (Optional) Auto-trigger scraper for each expanded query?
    // User can trigger manually or we can add logic here.
  }
};
