import { ChildContextProvider, createContext } from 'react';
import { TrimergeClient } from 'trimerge-sync';

export const TrimergeContext = createContext<
  TrimergeClient<any, any, any> | undefined
>(undefined);
