const debug = require('debug')('feathers-koa');
const Koa = require('koa');
const KoaRouter = require('koa-router');
const Proto = require('uberproto');

// FIXME: hack to support express style middleware
function expressifyMiddleware(args) {
	for (let index in args) {
		let original = args[index];
		if (typeof original === 'function') {
			args[index] = function({ req, res }, next) {
				original.call(this, req, res, next);
			};
		}
	}
}

module.exports = function feathersKoa(feathersApp) {
	if (!feathersApp || typeof feathersApp.setup !== 'function') {
		throw new Error('feathers-koa requires a valid Feathers application instance');
	}

	if (!feathersApp.version || feathersApp.version < '3.0.0') {
		throw new Error(`feathers-koa requires an instance of a Feathers application version 3.x or later (got ${feathersApp.version || 'unknown'})`);
	}

	const koaApp = new Koa();
	const router = koaApp.router = new KoaRouter();
	koaApp.use(router.routes());
	koaApp.use(router.allowedMethods());

	// An Uberproto mixin that provides the extended functionality
	const mixin = {
		use(location) {
			let service = null;
			let middleware = Array.from(arguments)
				.slice(1)
				.reduce((middleware, arg) => {
					if (typeof arg === 'function') {
						middleware[service ? 'after' : 'before'].push(arg);
					}
					else if (!service) {
						service = arg;
					}
					else {
						throw new Error('Invalid options passed to app.use');
					}
					return middleware;
				}, {
					before: [],
					after: [],
				});

			const hasMethod = methods => methods.some(name =>
				(service && typeof service[name] === 'function')
			);

			// Check for service (any object with at least one service method)
			if (hasMethod([ 'handle', 'set' ]) || !hasMethod(this.methods.concat('setup'))) {
				expressifyMiddleware(arguments);

				debug('Passing app.use call to Koa app');
				return this._super.apply(this, arguments);
			}

			debug('Registering service with middleware', middleware);
			// Since this is a serivce, call Feathers `.use`
			feathersApp.use.call(this, location, service, { middleware });

			return this;
		},

		listen() {
			const server = this._super.apply(this, arguments);

			this.setup(server);
			debug('Feathers application listening');

			return server;
		},

		route(uri) {
			// hack to support express style routing
			return {
				get(...middleware) {
					expressifyMiddleware(middleware);
					router.get(uri, ...middleware);
				},
				post(...middleware) {
					expressifyMiddleware(middleware);
					router.post(uri, ...middleware);
				},
				patch(...middleware) {
					expressifyMiddleware(middleware);
					router.patch(uri, ...middleware);
				},
				put(...middleware) {
					expressifyMiddleware(middleware);
					router.put(uri, ...middleware);
				},
				delete(...middleware) {
					expressifyMiddleware(middleware);
					router.delete(uri, ...middleware);
				},
			};
		},
	};

	// Copy all non-existing properties (including non-enumerables)
	// that don't already exist on the Koa app
	Object.getOwnPropertyNames(feathersApp).forEach(prop => {
		const feathersProp = Object.getOwnPropertyDescriptor(feathersApp, prop);

		if (!koaApp[prop] && feathersProp !== undefined) {
			Object.defineProperty(koaApp, prop, feathersProp);
		}
	});

	return Proto.mixin(mixin, koaApp);
};
