import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IEnrichment extends Document {
  leadId: Types.ObjectId;
  techStack: string[];
  cms: 'WordPress' | 'Shopify' | 'Wix' | 'Squarespace' | 'custom' | 'unknown';
  performanceScore: number;
  seoScore: number;
  siteQualityScore: number;
  mobileFriendly: boolean;
  hasSSL: boolean;
  hasChatbot: boolean;
  phone?: string;
  email?: string;
  socialLinks: string[];
  websiteQuality: 'outdated' | 'basic' | 'modern' | 'unknown';
  hasBookingSystem: boolean;
  hasEcommerce: boolean;
  hasContactForm: boolean;
  automationLevel: 'none' | 'basic' | 'moderate' | 'advanced';
  automationSignals: string[];
  socialActivity: 'active' | 'inactive' | 'unknown';
  socialConfidence: 'high' | 'medium' | 'low' | 'unverified';
  socialDetectionLayers: string[];
  dataQualityFlags: string[];
  needsManualReview: boolean;
  detectedPains: string[];
  primaryPain?: string;
  pitchAngle?: string;
  aiAnalysisCacheKey?: string;
  rawHtmlSnapshot?: string;
  siteStatus: 'live' | 'unreachable' | 'redirect' | 'error';
  enrichedAt: Date;
}

const EnrichmentSchema = new Schema<IEnrichment>(
  {
    leadId: { type: Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
    techStack: { type: [String], default: [], validate: [(v: string[]) => v.length <= 10, 'Max 10 tech items'] },
    cms: {
      type: String,
      enum: ['WordPress', 'Shopify', 'Wix', 'Squarespace', 'custom', 'unknown'],
      default: 'unknown',
    },
    performanceScore: { type: Number, default: 0, min: 0, max: 100 },
    seoScore: { type: Number, default: 0, min: 0, max: 100 },
    siteQualityScore: { type: Number, default: 0, min: 0, max: 100 },
    mobileFriendly: { type: Boolean, default: false },
    hasSSL: { type: Boolean, default: false },
    hasChatbot: { type: Boolean, default: false },
    hasBookingSystem: { type: Boolean, default: false },
    hasEcommerce: { type: Boolean, default: false },
    hasContactForm: { type: Boolean, default: false },
    automationLevel: {
      type: String,
      enum: ['none', 'basic', 'moderate', 'advanced'],
      default: 'none',
    },
    automationSignals: [{ type: String }],
    socialActivity: {
      type: String,
      enum: ['active', 'inactive', 'unknown'],
      default: 'unknown',
    },
    socialConfidence: {
      type: String,
      enum: ['high', 'medium', 'low', 'unverified'],
      default: 'unverified',
    },
    socialDetectionLayers: { type: [String], default: [] },
    dataQualityFlags: { type: [String], default: [] },
    needsManualReview: { type: Boolean, default: false },
    phone: { type: String },
    email: { type: String },
    socialLinks: { type: [String], default: [] },
    websiteQuality: {
      type: String,
      enum: ['outdated', 'basic', 'modern', 'unknown'],
      default: 'unknown'
    },
    detectedPains: {
      type: [String],
      default: [],
      validate: [(v: string[]) => v.length <= 5, 'Max 5 detected pains'],
    },
    primaryPain: { type: String },
    pitchAngle: { type: String },
    aiAnalysisCacheKey: { type: String },
    // First 5000 chars of stripped HTML only — NOT full HTML
    rawHtmlSnapshot: { type: String, maxlength: 5000 },
    siteStatus: {
      type: String,
      enum: ['live', 'unreachable', 'redirect', 'error'],
      default: 'live',
    },
    enrichedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

export const Enrichment = mongoose.model<IEnrichment>('Enrichment', EnrichmentSchema);
