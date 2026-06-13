import { AbstractStorage } from './AbstractStorage';

export class NameStorage extends AbstractStorage {
	constructor(dbAdapter) {
		super('Names', dbAdapter);
	}
}
