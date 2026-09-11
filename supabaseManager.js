/**
 * Supabase Manager for N/A Browser
 * Handles Supabase Client initialization, Authentication, Session persistence,
 * and 2-way Profile Synchronization.
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

class SupabaseManager {
  constructor(appDataDir) {
    this.appDataDir = appDataDir;
    this.configFile = path.join(appDataDir, 'supabase_config.json');
    this.sessionFile = path.join(appDataDir, 'supabase_session.json');
    this.client = null;
    this.currentUser = null;
    this.currentSession = null;

    this.initClient();
  }

  // --- Configuration ---
  getConfig() {
    try {
      if (fs.existsSync(this.configFile)) {
        return JSON.parse(fs.readFileSync(this.configFile, 'utf-8'));
      }
    } catch (e) {
      console.error('[SupabaseManager] Failed to read config:', e);
    }
    return {
      url: 'https://atherarelnclynttiymg.supabase.co',
      anonKey: 'sb_publishable_8rYj6x9gDdIxG-V0LojNow_fNQlzQge'
    };
  }

  saveConfig(config) {
    try {
      const data = {
        url: (config.url || '').trim(),
        anonKey: (config.anonKey || '').trim()
      };
      fs.writeFileSync(this.configFile, JSON.stringify(data, null, 2), 'utf-8');
      this.initClient();
      return { ok: true };
    } catch (e) {
      console.error('[SupabaseManager] Failed to save config:', e);
      return { ok: false, error: e.message };
    }
  }

  initClient() {
    const config = this.getConfig();
    if (config.url && config.anonKey) {
      try {
        this.client = createClient(config.url, config.anonKey, {
          auth: {
            persistSession: false,
            autoRefreshToken: true,
            detectSessionInUrl: false
          }
        });
        this.restoreSession();
      } catch (err) {
        console.error('[SupabaseManager] Init client error:', err);
        this.client = null;
      }
    } else {
      this.client = null;
    }
  }

  isConfigured() {
    return !!(this.client);
  }

  async testConnection(url, anonKey) {
    try {
      const testUrl = (url || this.getConfig().url || '').trim();
      const testKey = (anonKey || this.getConfig().anonKey || '').trim();
      if (!testUrl || !testKey) {
        return { ok: false, error: 'Chưa nhập URL hoặc Anon Key!' };
      }
      const tempClient = createClient(testUrl, testKey, { auth: { persistSession: false } });
      const { data, error } = await tempClient.from('profiles').select('id').limit(1);
      if (error && error.code === 'PGRST205') {
        return { ok: true, message: 'Kết nối Supabase thành công! (Vui lòng chạy lệnh SQL để tạo bảng profiles)' };
      }
      if (error && error.code !== 'PGRST116') {
        return { ok: false, error: error.message || 'Không thể kết nối đến Supabase' };
      }
      return { ok: true, message: 'Kết nối Supabase thành công!' };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  // --- Session Storage ---
  saveSessionToDisk(session) {
    try {
      if (session) {
        fs.writeFileSync(this.sessionFile, JSON.stringify(session, null, 2), 'utf-8');
      } else if (fs.existsSync(this.sessionFile)) {
        fs.unlinkSync(this.sessionFile);
      }
    } catch (e) {
      console.error('[SupabaseManager] Save session error:', e);
    }
  }

  async restoreSession() {
    if (!this.client || !fs.existsSync(this.sessionFile)) return null;
    try {
      const raw = fs.readFileSync(this.sessionFile, 'utf-8');
      const session = JSON.parse(raw);
      if (session && session.access_token && session.refresh_token) {
        const { data, error } = await this.client.auth.setSession({
          access_token: session.access_token,
          refresh_token: session.refresh_token
        });
        if (!error && data?.session) {
          this.currentSession = data.session;
          this.currentUser = data.user;
          this.saveSessionToDisk(data.session);
          return data.user;
        }
      }
    } catch (e) {
      console.warn('[SupabaseManager] Restore session failed:', e.message);
    }
    this.currentUser = null;
    this.currentSession = null;
    return null;
  }

  // --- Authentication with PIN/Account Code ---
  async loginWithPin(pin) {
    if (!this.client) this.initClient();
    if (!this.client) return { ok: false, error: 'Chưa khởi tạo Supabase Client' };

    const cleanPin = String(pin || '151206').trim();
    const email = `user${cleanPin}@nabrowser.cloud`;
    const password = `NABrowser#${cleanPin}`;

    try {
      let { data, error } = await this.client.auth.signInWithPassword({ email, password });
      if (error && (error.message.includes('Invalid login credentials') || error.message.includes('not found') || error.status === 400)) {
        const upRes = await this.client.auth.signUp({ email, password });
        if (upRes.data?.session) {
          data = upRes.data;
          error = null;
        }
      }
      if (data?.session) {
        this.currentSession = data.session;
        this.currentUser = data.user;
        this.saveSessionToDisk(data.session);
        return { ok: true, user: data.user, session: data.session };
      }
      return { ok: false, error: error?.message || 'Đăng nhập đám mây thất bại' };
    } catch (e) {
      console.error('[SupabaseManager] loginWithPin error:', e);
      return { ok: false, error: e.message };
    }
  }

  // --- Authentication ---
  async signUp(email, password) {
    if (!this.client) {
      return { ok: false, error: 'Chưa cấu hình Supabase URL & Anon Key trong Cài đặt!' };
    }
    try {
      const { data, error } = await this.client.auth.signUp({
        email: email.trim(),
        password: password
      });
      if (error) {
        return { ok: false, error: error.message };
      }
      if (data?.session) {
        this.currentSession = data.session;
        this.currentUser = data.user;
        this.saveSessionToDisk(data.session);
      }
      return {
        ok: true,
        user: data.user,
        needsConfirmation: !data.session
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async signIn(email, password) {
    if (!this.client) {
      return { ok: false, error: 'Chưa cấu hình Supabase URL & Anon Key trong Cài đặt!' };
    }
    try {
      const { data, error } = await this.client.auth.signInWithPassword({
        email: email.trim(),
        password: password
      });
      if (error) {
        return { ok: false, error: error.message };
      }
      this.currentSession = data.session;
      this.currentUser = data.user;
      this.saveSessionToDisk(data.session);
      return { ok: true, user: data.user, session: data.session };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async signOut() {
    try {
      if (this.client) {
        await this.client.auth.signOut();
      }
    } catch (e) {}
    this.currentUser = null;
    this.currentSession = null;
    this.saveSessionToDisk(null);
    return { ok: true };
  }

  async getSession() {
    if (!this.client) {
      return { ok: false, configured: false, loggedIn: false };
    }
    if (!this.currentUser) {
      await this.restoreSession();
    }
    if (this.currentUser) {
      return {
        ok: true,
        configured: true,
        loggedIn: true,
        user: {
          id: this.currentUser.id,
          email: this.currentUser.email,
          createdAt: this.currentUser.created_at
        }
      };
    }
    return { ok: true, configured: true, loggedIn: false };
  }

  async ensureAuth() {
    if (!this.client) this.initClient();
    if (!this.currentUser) {
      await this.restoreSession();
    }
    if (!this.currentUser) {
      await this.loginWithPin('151206');
    }
    return !!this.currentUser;
  }

  // --- Profile Synchronization ---
  toRemoteRow(p, userId) {
    let remoteNotes = p.notes || '';
    if (p.webData) {
      try {
        remoteNotes = JSON.stringify({
          _is_web_data_container: true,
          note: p.notes || '',
          webData: p.webData
        });
      } catch (e) {
        remoteNotes = p.notes || '';
      }
    }

    return {
      id: String(p.id),
      user_id: userId,
      name: p.name || 'Untitled Profile',
      device_id: p.deviceId || null,
      proxy: p.proxy || {},
      city_key: p.cityKey || null,
      city_name: p.cityName || null,
      geo: p.geo || {},
      timezone: p.timezone || 'Asia/Ho_Chi_Minh',
      language: p.language || 'vi-VN',
      selected_extensions: p.selectedExtensions || [],
      custom_window: p.customWindow || null,
      start_url: p.startUrl || '',
      notes: remoteNotes,
      created_at: typeof p.createdAt === 'number' ? p.createdAt : Date.now(),
      updated_at: new Date().toISOString()
    };
  }

  toLocalProfile(r) {
    let noteText = r.notes || '';
    let webData = null;
    if (typeof noteText === 'string' && noteText.startsWith('{') && noteText.includes('_is_web_data_container')) {
      try {
        const parsed = JSON.parse(noteText);
        noteText = parsed.note || '';
        webData = parsed.webData || null;
      } catch (e) {}
    }

    return {
      id: r.id,
      name: r.name,
      deviceId: r.device_id,
      proxy: r.proxy || {},
      cityKey: r.city_key || '',
      cityName: r.city_name || '',
      geo: r.geo || {},
      timezone: r.timezone || 'Asia/Ho_Chi_Minh',
      language: r.language || 'vi-VN',
      selectedExtensions: r.selected_extensions || [],
      customWindow: r.custom_window || null,
      startUrl: r.start_url || '',
      notes: noteText,
      webData: webData,
      createdAt: r.created_at || Date.now()
    };
  }

  async pullProfiles() {
    await this.ensureAuth();
    if (!this.client || !this.currentUser) {
      return { ok: false, error: 'Chưa đăng nhập tài khoản Supabase!' };
    }
    try {
      const { data, error } = await this.client
        .from('profiles')
        .select('*')
        .eq('user_id', this.currentUser.id)
        .order('created_at', { ascending: true });

      if (error) {
        return { ok: false, error: error.message };
      }

      const remoteProfiles = (data || []).map(r => this.toLocalProfile(r));
      return { ok: true, profiles: remoteProfiles };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async pushSingleProfile(profile) {
    await this.ensureAuth();
    if (!this.client || !this.currentUser) {
      return { ok: false, error: 'Chưa đăng nhập' };
    }
    try {
      const row = this.toRemoteRow(profile, this.currentUser.id);
      const { error } = await this.client
        .from('profiles')
        .upsert(row, { onConflict: 'id' });

      if (error) return { ok: false, error: error.message };
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async deleteRemoteProfile(profileId) {
    await this.ensureAuth();
    if (!this.client || !this.currentUser) {
      return { ok: false, error: 'Chưa đăng nhập' };
    }
    try {
      const { error } = await this.client
        .from('profiles')
        .delete()
        .eq('id', String(profileId))
        .eq('user_id', this.currentUser.id);

      if (error) {
        console.error('[SupabaseManager] deleteRemoteProfile error:', error);
        return { ok: false, error: error.message };
      }
      console.log(`[SupabaseManager] ✅ Đã xóa vĩnh viễn profile ${profileId} trên Supabase Cloud!`);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async pushAllProfiles(localProfiles) {
    await this.ensureAuth();
    if (!this.client || !this.currentUser) {
      return { ok: false, error: 'Chưa đăng nhập' };
    }
    try {
      if (!localProfiles || !localProfiles.length) return { ok: true, count: 0 };
      const rows = localProfiles.map(p => this.toRemoteRow(p, this.currentUser.id));
      const { error } = await this.client
        .from('profiles')
        .upsert(rows, { onConflict: 'id' });

      if (error) return { ok: false, error: error.message };
      return { ok: true, count: rows.length };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
}

module.exports = SupabaseManager;
