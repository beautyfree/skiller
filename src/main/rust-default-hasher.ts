/**
 * Rust `std::hash::DefaultHasher` (SipHasher13, keys 0,0) compatible hashing
 * for `str::hash` — matches `write_str` (UTF-8 bytes + 0xFF).
 * Ported from `library/core/src/hash/sip.rs` (Rust stable).
 */

const MASK64 = 0xffff_ffff_ffff_ffffn;

function u64(x: bigint): bigint {
	return x & MASK64;
}

function rotl64(v: bigint, r: number): bigint {
	return u64((v << BigInt(r)) | (v >> BigInt(64 - r)));
}

type State = { v0: bigint; v1: bigint; v2: bigint; v3: bigint };

function compress(state: State): void {
	let { v0, v1, v2, v3 } = state;
	v0 = u64(v0 + v1);
	v2 = u64(v2 + v3);
	v1 = rotl64(v1, 13);
	v1 ^= v0;
	v3 = rotl64(v3, 16);
	v3 ^= v2;
	v0 = rotl64(v0, 32);

	v2 = u64(v2 + v1);
	v0 = u64(v0 + v3);
	v1 = rotl64(v1, 17);
	v1 ^= v2;
	v3 = rotl64(v3, 21);
	v3 ^= v0;
	v2 = rotl64(v2, 32);
	state.v0 = v0;
	state.v1 = v1;
	state.v2 = v2;
	state.v3 = v3;
}

function cRounds(state: State): void {
	compress(state);
}

function dRounds(state: State): void {
	compress(state);
	compress(state);
	compress(state);
}

function loadIntLeU64(buf: Uint8Array, i: number): bigint {
	const view = new DataView(buf.buffer, buf.byteOffset + i, 8);
	return view.getBigUint64(0, true);
}

/** Loads a u64 using up to 7 bytes (see Rust `u8to64_le`) */
function u8to64Le(buf: Uint8Array, start: number, len: number): bigint {
	let i = 0;
	let out = 0n;
	if (i + 3 < len) {
		const view = new DataView(buf.buffer, buf.byteOffset + start + i, 4);
		out = BigInt(view.getUint32(0, true));
		i += 4;
	}
	if (i + 1 < len) {
		const view = new DataView(buf.buffer, buf.byteOffset + start + i, 2);
		out |= BigInt(view.getUint16(0, true)) << BigInt(i * 8);
		i += 2;
	}
	if (i < len) {
		out |= BigInt(buf[start + i]!) << BigInt(i * 8);
		i += 1;
	}
	return out;
}

class SipHasher13 {
	private k0 = 0n;
	private k1 = 0n;
	private length = 0;
	private state: State = { v0: 0n, v1: 0n, v2: 0n, v3: 0n };
	private tail = 0n;
	private ntail = 0;

	constructor(key0: bigint, key1: bigint) {
		this.k0 = key0;
		this.k1 = key1;
		this.reset();
	}

	private reset(): void {
		this.length = 0;
		this.state = {
			v0: this.k0 ^ 0x736f6d6570736575n,
			v1: this.k1 ^ 0x646f72616e646f6dn,
			v2: this.k0 ^ 0x6c7967656e657261n,
			v3: this.k1 ^ 0x7465646279746573n,
		};
		this.ntail = 0;
		this.tail = 0n;
	}

	write(msg: Uint8Array): void {
		const length = msg.length;
		this.length += length;
		let needed = 0;

		if (this.ntail !== 0) {
			needed = 8 - this.ntail;
			const take = Math.min(length, needed);
			const chunk = u8to64Le(msg, 0, take);
			this.tail |= chunk << BigInt(8 * this.ntail);
			if (length < needed) {
				this.ntail += length;
				return;
			}
			this.state.v3 ^= this.tail;
			cRounds(this.state);
			this.state.v0 ^= this.tail;
			this.ntail = 0;
		}

		const len = length - needed;
		const left = len & 7;
		let i = needed;
		while (i < len - left) {
			const mi = loadIntLeU64(msg, i);
			this.state.v3 ^= mi;
			cRounds(this.state);
			this.state.v0 ^= mi;
			i += 8;
		}
		this.tail = u8to64Le(msg, i, left);
		this.ntail = left;
	}

	/** Matches Rust `Hasher::write_str` for SipHasher13 */
	writeStr(s: string): void {
		this.write(new TextEncoder().encode(s));
		this.write(new Uint8Array([0xff]));
	}

	finish(): bigint {
		const state = { ...this.state };
		const b = u64((BigInt(this.length & 0xff) << 56n) | this.tail);
		state.v3 ^= b;
		cRounds(state);
		state.v0 ^= b;
		state.v2 ^= 0xffn;
		dRounds(state);
		return state.v0 ^ state.v1 ^ state.v2 ^ state.v3;
	}
}

/** Same as Rust `DefaultHasher::new()` + `str::hash` */
export function hashStrRustDefault(s: string): bigint {
	const h = new SipHasher13(0n, 0n);
	h.writeStr(s);
	return h.finish();
}

/** `local_dir_id` from `repos.rs`: `local-` + 16 hex (lower) of `finish()` */
export function localDirId(path: string): string {
	const finish = hashStrRustDefault(path);
	return `local-${finish.toString(16).padStart(16, "0")}`;
}
