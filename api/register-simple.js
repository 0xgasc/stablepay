import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://lxbrsiujmntrvzqdphhj.supabase.co';
const supabaseKey = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx4YnJzaXVqbW50cnZ6cWRwaGhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzU0OTMzNDksImV4cCI6MjA1MTA2OTM0OX0.WXJYoHgfG6BvsBU2VFJrEQZJgMSMjc9d-MhOVGLfSKo';

const supabase = createClient(supabaseUrl, supabaseKey);

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { companyName, contactName, email } = req.body;

    if (!companyName || !contactName || !email) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    // Generate login token
    const loginToken = crypto.randomBytes(32).toString('hex');
    const tokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    // Check if merchant exists
    const { data: existingMerchant, error: selectError } = await supabase
      .from('merchants')
      .select('*')
      .eq('email', email)
      .single();

    if (selectError && selectError.code !== 'PGRST116') { // PGRST116 = no rows returned
      throw selectError;
    }

    if (existingMerchant) {
      // Update existing merchant with new token
      const { data: updatedMerchant, error: updateError } = await supabase
        .from('merchants')
        .update({
          loginToken,
          tokenExpiresAt: tokenExpiresAt.toISOString()
        })
        .eq('email', email)
        .select()
        .single();

      if (updateError) throw updateError;

      console.log(`New login link for existing user ${email}: /login.html?token=${loginToken}`);
      
      return res.status(200).json({
        success: true,
        message: 'Login link sent! Check your email.',
        merchantId: updatedMerchant.id,
        // For development, include the token
        devToken: loginToken
      });
    }

    // Create new merchant
    const { data: newMerchant, error: insertError } = await supabase
      .from('merchants')
      .insert({
        email,
        companyName,
        contactName,
        loginToken,
        tokenExpiresAt: tokenExpiresAt.toISOString(),
        role: 'MERCHANT',
        paymentMode: 'DIRECT',
        networkMode: 'TESTNET',
        isActive: false,
        setupCompleted: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      })
      .select()
      .single();

    if (insertError) throw insertError;

    console.log(`Login link for ${email}: /login.html?token=${loginToken}`);

    return res.status(201).json({
      success: true,
      message: 'Registration successful! Check your email for the login link.',
      merchantId: newMerchant.id,
      // For development, include the token
      devToken: loginToken
    });
  } catch (error) {
    console.error('Registration error:', error);
    return res.status(500).json({ 
      error: 'Registration failed',
      details: error.message 
    });
  }
}