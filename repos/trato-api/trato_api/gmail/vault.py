"""Encrypted local development vault, not a replacement for business persistence."""
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import time

from cryptography.fernet import Fernet, InvalidToken


class GmailError(Exception):
    def __init__(self, code, status=503, *, uncertain=False):
        super().__init__(code)
        self.code, self.status, self.uncertain = code, status, uncertain


class TokenVault:
    def __init__(self, path, key, *, clock=time.time):
        try:
            self.cipher = Fernet(key.encode())
        except (ValueError, TypeError):
            raise GmailError('GMAIL_ENCRYPTION_NOT_CONFIGURED') from None
        self.path, self.clock = Path(path), clock
        if self.path.is_symlink():
            raise GmailError('GMAIL_VAULT_NOT_CONFIGURED')
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        # Create with private permissions before SQLite opens it.
        descriptor = os.open(self.path, os.O_CREAT | os.O_RDWR, 0o600)
        os.close(descriptor)
        os.chmod(self.path, 0o600)
        with self.connect() as db:
            db.execute('CREATE TABLE IF NOT EXISTS connections (owner TEXT PRIMARY KEY, encrypted BLOB NOT NULL)')
            db.execute('CREATE TABLE IF NOT EXISTS oauth_states (digest TEXT PRIMARY KEY, owner TEXT NOT NULL, encrypted BLOB NOT NULL, expires REAL NOT NULL)')

    def connect(self):
        return sqlite3.connect(self.path, timeout=5)

    def encrypt(self, owner, data):
        return self.cipher.encrypt(json.dumps({'owner':owner,'data':data}).encode())

    def decrypt(self, owner, encrypted):
        try:
            data = json.loads(self.cipher.decrypt(encrypted))
            if data['owner'] != owner:
                raise ValueError()
            return data['data']
        except (InvalidToken, ValueError, KeyError, TypeError):
            raise GmailError('GMAIL_VAULT_UNREADABLE') from None

    def save(self, owner, data):
        with self.connect() as db:
            db.execute('INSERT INTO connections VALUES (?,?) ON CONFLICT(owner) DO UPDATE SET encrypted=excluded.encrypted', (owner,self.encrypt(owner,data)))

    def get(self, owner):
        with self.connect() as db:
            row = db.execute('SELECT encrypted FROM connections WHERE owner=?', (owner,)).fetchone()
        return self.decrypt(owner,row[0]) if row else None

    def delete(self, owner):
        with self.connect() as db:
            db.execute('DELETE FROM connections WHERE owner=?',(owner,))
            db.execute('DELETE FROM oauth_states WHERE owner=?',(owner,))

    def begin(self, owner, state, verifier):
        with self.connect() as db:
            db.execute('DELETE FROM oauth_states WHERE expires <= ?', (self.clock(),))
            # Starting a new consent flow invalidates older flows for this user.
            db.execute('DELETE FROM oauth_states WHERE owner=?', (owner,))
            db.execute('INSERT INTO oauth_states VALUES (?,?,?,?)', (hashlib.sha256(state.encode()).hexdigest(),owner,self.encrypt(owner,{'verifier':verifier}),self.clock()+600))

    def consume(self, owner, state):
        digest = hashlib.sha256(state.encode()).hexdigest()
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT encrypted,expires FROM oauth_states WHERE digest=? AND owner=?',(digest,owner)).fetchone()
            if not row or row[1] <= self.clock():
                raise GmailError('GMAIL_AUTHORIZATION_EXPIRED',409)
            db.execute('DELETE FROM oauth_states WHERE digest=? AND owner=?',(digest,owner))
        return self.decrypt(owner,row[0])['verifier']
