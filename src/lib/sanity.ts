import { createClient } from '@sanity/client';

// Sanity Content Lake client for read-only access from the website front-end.
// Project ID and dataset match the filetax-studio repo configuration.
// useCdn=true enables Sanity's CDN for faster reads with up to ~1 minute of staleness.
// For preview or draft content, use a separate client with useCdn=false and a token.
export const sanity = createClient({
  projectId: 'alh0fv7m',
  dataset: 'production',
  apiVersion: '2024-01-01',
  useCdn: true,
});
