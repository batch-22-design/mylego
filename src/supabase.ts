import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_KEY
);

export type LegoSet = {
  id: number;
  set_number: string;
  name: string;
  year: number;
  piece_count: number;
  theme: string;
  image_url: string | null;
  quantity: number;
  on_display: boolean;
};

export type Part = {
  id: number;
  part_num: string;
  part_name: string;
  color: string;
  quantity: number;
  image_url: string | null;
};
