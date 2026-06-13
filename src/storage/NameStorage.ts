import { AbstractStorage } from './AbstractStorage';

export class NameStorage extends AbstractStorage {
	constructor(dbAdapter: DatabaseAdapter) {
		super('Names', dbAdapter);
	}
}
