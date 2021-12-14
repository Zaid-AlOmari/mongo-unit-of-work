import { Collection, ClientSession, Filter, UpdateFilter } from 'mongodb';
import { defaultPaging, IAuditable, IPage } from '..';
import { Access, IProtectedResource, ResourceAccess } from '../interfaces/IProtectedResource';
import { AuditableRepository, AuditableRepositoryConfigs, defaultConfigs, RepositoryConfigs } from './AuditableRepository';

export type ProtectedRepositoryConfigs = RepositoryConfigs<AuditableRepositoryConfigs & {
  /**
   * check if the current user has global access to a resource type. default: (_,_) => false
   * @param resourceType the resource type to check access against.
   * @param neededAccess the needed access to validate against.
   * @returns a boolean that indicates whether the current user has the specified access to the resource or not.
   */
  hasGlobalAccces: (resourceType: string, neededAccess: ResourceAccess) => boolean;
  /**
   * allow the current user to remove his own write access to a resource.
   */
  allowRemoveOwnAccess: boolean;
}>;

export const defaultProtectedRepositoryConfigs: ProtectedRepositoryConfigs = {
  ...defaultConfigs,
  hasGlobalAccces: (resourceType: string, neededAccess: ResourceAccess) => false,
  /**
   * allow the current user to remove their own write access (default: false)
   */
  allowRemoveOwnAccess: false
}

export class ProtectedRepository<T extends IAuditable & IProtectedResource> extends AuditableRepository<T> {

  constructor(
    name: string,
    collection: Collection<T>,
    protected resourceType: string,
    session?: ClientSession,
    configs: Partial<ProtectedRepositoryConfigs> = defaultProtectedRepositoryConfigs
  ) {
    super(name, collection, session, { ...defaultProtectedRepositoryConfigs, ...configs });
  }

  protected get configs() {
    return this._configs as ProtectedRepositoryConfigs;
  }

  protected getAuthorizedFilter(filter: Filter<T>, neededAccess: ResourceAccess) {
    const userId = this._configs.getUserId();
    if (!userId) return undefined;
    if (this.configs.hasGlobalAccces(this.resourceType, neededAccess)) return filter;
    return <Filter<T>>{
      ...filter,
      [`acl.users.${userId}`]: { $bitsAllSet: neededAccess }
    }
  }

  /**
   * get one entity if the current user has the needed access.
   * @param filter a filter object used to find the entity.
   * @param neededAccess the needed access to validate against.
   * @param projection specify in a key value pair if certin keys to be returned from the store or not. check (https://docs.mongodb.com/manual/tutorial/project-fields-from-query-results/) 
   * @returns an entity object if found and the current user has the needed access to it, otherwise it returns undefined.
   */
  async getOneIfAuthorized(filter: Filter<T>, neededAccess: ResourceAccess, projection?: any) {
    const authorizedFilter = this.getAuthorizedFilter(filter, neededAccess);
    if (!authorizedFilter) return undefined;
    const result = await this.findOne(authorizedFilter, projection);
    return result || undefined;
  }

  /**
   * find many entities that the current user has the needed access to them.
   * @param filter a filter object used to find the entity.
   * @param neededAccess the needed access to validate against.
   * @param projection specify in a key value pair if certin keys to be returned from the store or not. check (https://docs.mongodb.com/manual/tutorial/project-fields-from-query-results/) 
   * @returns an array of entities that matches the current filter and the current user has the needed access to them, otherwise it returns empty array.
   */
  async findManyAuthorized(filter: Filter<T>, neededAccess: ResourceAccess, projection?: any) {
    const authorizedFilter = this.getAuthorizedFilter(filter, neededAccess);
    if (!authorizedFilter) return [];
    const result = await this.findMany(authorizedFilter, projection);
    return result;
  }

  /**
   * find many entities that the current user has the needed access to them using the pagination object.
   * @param filter a filter object used to find the entities.
   * @param neededAccess the needed access to validate against.
   * @param projection specify in a key value pair if certin keys to be returned from the store or not. check (https://docs.mongodb.com/manual/tutorial/project-fields-from-query-results/) 
   * @param paging specify the index and the size of the requested page.
   * @returns a page that contains the items key which is an array of entities that matches the current filter and the current user has the needed access to them, otherwise it returns empty page.
   */
  async findManyPageAuthorized(filter: Filter<T>, neededAccess: ResourceAccess, paging = defaultPaging, projection?: any) {
    const authorizedFilter = this.getAuthorizedFilter(filter, neededAccess);
    if (!authorizedFilter) return <IPage<T>>{
      index: paging.index,
      size: paging.size,
      total: 0,
      items: []
    };
    const result = await this.findManyPage(authorizedFilter, paging, projection);
    return result;
  }

  /**
   * count how many entities that the current user has the needed access to using the filter.
   * @param filter a filter object used to find the entities.
   * @param neededAccess the needed access to validate against.
   * @returns the number of entities.
   */
  async countAuthorized(filter: Filter<T>, neededAccess: ResourceAccess) {
    const authorizedFilter = this.getAuthorizedFilter(filter, neededAccess);
    if (!authorizedFilter) return [];
    const result = await this.count(authorizedFilter);
    return result;
  }

  /**
   * update the access list of one entity which matches the filter.
   * @param filter a filter object used to find one entity.
   * @param users the access list of users with their respctive access bits.
   * @returns the updated entity.
   */
  async updateOneAccess(filter: Filter<T>, users: { [userId: string]: ResourceAccess }) {
    const authorizedFilter = this.getAuthorizedFilter(filter, Access.write);
    if (!authorizedFilter) return undefined;
    const $set = <UpdateFilter<T>['$set']>{};
    const $unset = <UpdateFilter<T>['$unset']>{};
    for (const userId in users) {
      const accessObject = { [`acl.users.${userId}`]: users[userId] }
      if ((users[userId] & Access.write) === Access.none) {
        // don't allow the current user to remove their own write access.
        if (userId === this._configs.getUserId() && this.configs.allowRemoveOwnAccess) continue;
        Object.assign($unset, accessObject);
      } else {
        Object.assign($set, accessObject);
      }

    }
    const result = await this.findOneAndUpdate(authorizedFilter, { $set, $unset }, { returnDocument: 'after' });
    return result || undefined;
  }


  /**
   * update the access list of one entity which matches the filter.
   * @param filter a filter object used to find one entity.
   * @param users the access list of users with their respctive access bits.
   * @returns the updated entities count.
   */
  async updateManyAccess(filter: Filter<T>, users: { [userId: string]: ResourceAccess }): Promise<number> {
    const authorizedFilter = this.getAuthorizedFilter(filter, Access.write);
    if (!authorizedFilter) return 0;
    const $set = <UpdateFilter<T>['$set']>{};
    const $unset = <UpdateFilter<T>['$unset']>{};
    for (const userId in users) {
      const accessObject = { [`acl.users.${userId}`]: users[userId] }
      if ((users[userId] & Access.write) === Access.none) {
        // don't allow the current user to remove their own write access.
        if (userId === this._configs.getUserId() && this.configs.allowRemoveOwnAccess) continue;
        Object.assign($unset, accessObject);
      } else {
        Object.assign($set, accessObject);
      }

    }
    const result = await this.update(authorizedFilter, { $set, $unset });
    return result.modifiedCount;
  }


  /**
  * delete an entity that matches the filter if the current user has the `delete` resource access.
  * @param filter a filter object used to find one entity.
  * @returns the deleted entity.
  */
  async deleteOneAuthorized(filter: Filter<T>) {
    const authorizedFilter = this.getAuthorizedFilter(filter, Access.delete);
    if (!authorizedFilter) return undefined;
    return await this.deleteOne(authorizedFilter);
  }


  /**
  * delete the entities that matches the filter if the current user has the `delete` resource access.
  * @param filter a filter object used to find many entities.
  * @returns the deleted count of entities.
  */
  async deleteManyAuthorized(filter: Filter<T>) {
    const authorizedFilter = this.getAuthorizedFilter(filter, Access.delete);
    if (!authorizedFilter) return undefined;
    return await this.deleteMany(authorizedFilter);
  }
}
