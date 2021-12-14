/**
 * a flag enum that contains the bits for various access levels, up to 8 bits.
 */
export enum Access {
  none = 0,
  read = 1 << 0, // 00001
  write = 1 << 1,     // 00010
  add = 1 << 2,    // 00100
  delete = 1 << 3,   // 01000
  all = ~(~0 << 8)   // 11111111
}

export type ResourceAccess = Access | number;

export interface IProtectedResource {
  /**
   * the access control list of this entity.
   */
  acl: {
    /**
     * the type of the resource.
     */
    type: string;
    /**
     * a key value pair of users ids being the key and the resource access being the value.
     */
    users: { [userId: string]: ResourceAccess; }
  }
}