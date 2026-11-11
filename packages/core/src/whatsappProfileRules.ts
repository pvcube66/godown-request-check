/** Browser-safe parts of the business profile (no database code). */
export const VERTICALS: [string, string][] = [['', 'Not set'], ['GOVT', 'Government'], ['EDU', 'Education'], ['NONPROFIT', 'Non-profit'], ['PROF_SERVICES', 'Professional services'], ['OTHER', 'Other'], ['RETAIL', 'Shopping and retail'], ['HEALTH', 'Health'], ['FINANCE', 'Finance'], ['TRAVEL', 'Travel']];
export interface BusinessProfile { about: string; description: string; address: string; email: string; websites: string[]; vertical: string; pictureUrl: string }
export const EMPTY_PROFILE: BusinessProfile = { about: '', description: '', address: '', email: '', websites: [], vertical: '', pictureUrl: '' };

