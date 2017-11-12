import {createStore, applyMiddleware, combineReducers} from 'redux';
import { createLogger } from 'redux-logger';
import thunkMiddleware from 'redux-thunk';
import { composeWithDevTools } from 'redux-devtools-extension';
import user from './user';
import streetspots from './street-spots';
import map from './map';

const reducer = combineReducers(
	{
    user,
    streetspots,
    map
	}
);

const store = createStore(
  reducer,
  composeWithDevTools(applyMiddleware(
    thunkMiddleware,
    createLogger()
  ))
);

export default store;

export * from './user';
export * from './map';
export * from './street-spots';
