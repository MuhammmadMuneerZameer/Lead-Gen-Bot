export class QueryExpansionService {
  private static MAJOR_CITIES = [
    'Karachi', 'Lahore', 'Islamabad', 'Rawalpindi', 
    'Faisalabad', 'Multan', 'Hyderabad', 'Peshawar', 'Quetta'
  ];

  /**
   * Expands a keyword into multiple location-based queries focused on local SMEs.
   * @param keyword The industry/niche keyword (e.g., "Dentist")
   * @param limit Number of expansion variations to return
   */
  static expandQuery(keyword: string, limit = 5): string[] {
    const queries = new Set<string>();
    
    // 1. Keyword + Major Cities (Targeting local hubs)
    const cities = [...this.MAJOR_CITIES]
      .sort(() => 0.5 - Math.random())
      .slice(0, Math.min(limit, this.MAJOR_CITIES.length));
      
    cities.forEach(city => {
      queries.add(`${keyword} in ${city}`);
      queries.add(`best ${keyword} ${city}`);
    });
    
    // 2. Local-intent variations
    queries.add(`${keyword} near me`);
    queries.add(`local ${keyword} services`);
    queries.add(`${keyword} contact information`);

    return Array.from(queries).slice(0, limit + 3);
  }

  /**
   * Generates specific "Missing Website" search queries
   */
  static getOpportunityQueries(keyword: string): string[] {
    return [
      `${keyword} no website`,
      `${keyword} facebook page only`,
      `${keyword} small business list`
    ];
  }
}
