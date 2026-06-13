import { AbstractStorage } from './AbstractStorage';

export class NameStorage extends AbstractStorage {
	constructor(dbAdapter: any) {
		super('Names', dbAdapter);
	}
}
